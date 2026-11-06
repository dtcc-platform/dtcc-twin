import { setTimeout as sleep } from "node:timers/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { HttpException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Bounds, Dataset, Job } from "@repo/contracts";
import { ValidationException } from "../../common/errors/validation.exception.js";
import type { Env } from "../../config/env.schema.js";
import { EngineUnavailableError } from "../../infra/engine/engine.errors.js";
import { DatasetsService } from "../datasets/datasets.service.js";
import { JobsService } from "../jobs/jobs.service.js";
import type { JobReport, ToolCall } from "./chat-messages.js";
import { ChatsRepository } from "./chats.repository.js";

const datasetToolPrefix = "run_";
// A tool's name is at most 64 characters.
const maxDatasetName = 64 - datasetToolPrefix.length;
// The app passes the selected area as the bounds, and the engine always delivers a package, so the model sets neither.
const appParameters = new Set(["bounds", "format"]);
// A manifest past this would crowd the conversation; Core allows up to 4 MiB.
const maxResultCharacters = 64 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a tool call acts on behalf of: the chat's owner, the chat, and the area selected with the latest message. */
export type ToolContext = { userId: string; chatId: string; bounds: Bounds | null };

export type ToolOutcome = {
  block: Anthropic.ToolResultBlockParam;
  call: ToolCall;
  /** A job whose end this result tells the model, so the chat stops waiting for it. */
  reportedJobId: string | null;
};

const getJobTool: Anthropic.Tool = {
  name: "get_job",
  description:
    "The current state of one of the user's jobs, with its result once it has completed. A job started in this chat " +
    "reports its result in the chat by itself, so use this only when the user asks about a job.",
  input_schema: {
    type: "object",
    properties: {
      job_id: { type: "string", description: "The job's id, from the result of the tool that started it." },
    },
    required: ["job_id"],
    additionalProperties: false,
  },
};

/** A Dataset as a tool the model can call, its parameters from Core's schema; null when its name can't be a tool's. */
export function datasetTool(dataset: Dataset): Anthropic.Tool | null {
  if (dataset.name.length > maxDatasetName) return null;

  const { properties, required, ...schema } = dataset.argsSchema;
  const inputSchema: Anthropic.Tool.InputSchema = { ...schema, type: "object" };
  if (isRecord(properties)) {
    inputSchema.properties = Object.fromEntries(Object.entries(properties).filter(([key]) => !appParameters.has(key)));
  }
  if (Array.isArray(required)) {
    inputSchema.required = required.filter((key): key is string => typeof key === "string" && !appParameters.has(key));
  }

  const duration = dataset.timeoutHint ? ` Core expects it to take up to ${String(dataset.timeoutHint)} seconds.` : "";
  return {
    name: `${datasetToolPrefix}${dataset.name}`,
    description:
      `${dataset.title}. ${dataset.description}\n\n` +
      "Runs as a job on DTCC Engine over the area selected on the map, which the app passes as its bounds. " +
      `A job can take from seconds to hours.${duration}`,
    input_schema: inputSchema,
  };
}

/** The Dataset a tool runs, or null for a tool that runs none. */
export function datasetOfTool(name: string): string | null {
  return name.startsWith(datasetToolPrefix) ? name.slice(datasetToolPrefix.length) : null;
}

/** The tools the chat model may call, and what they do: every one acts as the chat's owner, never as anyone else. */
@Injectable()
export class ChatTools {
  private readonly logger = new Logger(ChatTools.name);
  private readonly waitMs: number;
  private readonly allowed: ReadonlySet<string> | null;

  constructor(
    private readonly datasets: DatasetsService,
    private readonly jobs: JobsService,
    private readonly repository: ChatsRepository,
    config: ConfigService<Env, true>,
  ) {
    this.waitMs = config.get("CHAT_JOB_WAIT_MS", { infer: true });
    const allowed = config.get("CHAT_DATASETS", { infer: true });
    this.allowed = allowed ? new Set(allowed) : null;
  }

  /** One tool per Dataset the chat may run, sorted by name so the cached prefix stays the same, and get_job. */
  async definitions(): Promise<Anthropic.Tool[]> {
    let datasets: Dataset[] = [];
    try {
      datasets = (await this.datasets.list()).items;
    } catch (error) {
      // Without the engine no Dataset can run, but the chat can still answer.
      if (!(error instanceof EngineUnavailableError)) throw error;
    }
    const tools = datasets
      .filter((dataset) => this.isAllowed(dataset.name))
      .flatMap((dataset) => datasetTool(dataset) ?? []);
    return [...tools, getJobTool];
  }

  /** Runs one tool call. Whatever goes wrong becomes an error result the model can explain, never an exception. */
  async run(context: ToolContext, use: Anthropic.ToolUseBlockParam): Promise<ToolOutcome> {
    const dataset = datasetOfTool(use.name);
    if (dataset !== null && this.isAllowed(dataset)) return this.runDataset(context, use, dataset);
    if (use.name === getJobTool.name) return this.getJob(context, use);
    return failure(use, null, `There is no tool named ${use.name}.`);
  }

  /** The job as the model is told it: its state, then its manifest once it has completed. */
  async report(userId: string, job: Job): Promise<JobReport> {
    const report: JobReport = { job_id: job.id, dataset: job.dataset, state: job.state };
    switch (job.state) {
      case "queued":
      case "running":
        if (job.progress) report["progress"] = job.progress;
        report["note"] =
          "The job is still running. Its result will be posted in this chat when it finishes; don't wait or poll for it.";
        break;
      case "completed":
        Object.assign(report, await this.result(userId, job.id));
        break;
      case "failed":
        report["error"] = job.error;
        break;
      case "cancelled":
        report["note"] = "The job was cancelled before it ran.";
        break;
    }
    return report;
  }

  private async runDataset(
    context: ToolContext,
    use: Anthropic.ToolUseBlockParam,
    dataset: string,
  ): Promise<ToolOutcome> {
    if (!context.bounds) {
      return failure(use, dataset, "No area is selected on the map. Ask the user to draw one, then try again.");
    }
    if (!isRecord(use.input)) return failure(use, dataset, "The tool's input must be an object.");
    const parameters = Object.fromEntries(Object.entries(use.input).filter(([key]) => !appParameters.has(key)));

    let job: Job;
    try {
      job = await this.jobs.create(context.userId, { dataset, parameters: { ...parameters, bounds: context.bounds } });
    } catch (error) {
      if (error instanceof HttpException) return failure(use, dataset, rejectionOf(error));
      throw error;
    }
    await this.repository.linkJob(context.chatId, job.id);

    const settled = await this.waitBriefly(context.userId, job);
    return this.outcome(context.userId, use, settled, { toolUseId: use.id, tool: use.name, dataset, jobId: job.id });
  }

  private async getJob(context: ToolContext, use: Anthropic.ToolUseBlockParam): Promise<ToolOutcome> {
    const jobId = isRecord(use.input) ? use.input["job_id"] : undefined;
    if (typeof jobId !== "string" || !uuidPattern.test(jobId)) return failure(use, null, "job_id must be a job's id.");

    let job: Job;
    try {
      job = await this.jobs.get(context.userId, jobId);
    } catch (error) {
      if (error instanceof NotFoundException) return failure(use, null, `The user has no job ${jobId}.`);
      throw error;
    }
    return this.outcome(context.userId, use, job, { toolUseId: use.id, tool: use.name, dataset: null, jobId: null });
  }

  private async outcome(
    userId: string,
    use: Anthropic.ToolUseBlockParam,
    job: Job,
    call: ToolCall,
  ): Promise<ToolOutcome> {
    const report = await this.report(userId, job);
    return {
      block: { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(report) },
      call,
      reportedJobId: isFinishedJob(job) ? job.id : null,
    };
  }

  // Asks the engine about the job it just started until it finishes or CHAT_JOB_WAIT_MS has passed.
  private async waitBriefly(userId: string, job: Job): Promise<Job> {
    const deadline = Date.now() + this.waitMs;
    const pause = Math.min(1000, Math.max(50, this.waitMs / 20));
    let current = job;
    while (!isFinishedJob(current) && Date.now() + pause <= deadline) {
      await sleep(pause);
      current = await this.jobs.refresh(userId, current.id);
    }
    return current;
  }

  private async result(userId: string, jobId: string): Promise<Record<string, unknown>> {
    try {
      const { manifest } = await this.jobs.result(userId, jobId);
      if (JSON.stringify(manifest).length > maxResultCharacters) {
        return { note: "The job completed, but its result is too large to read here." };
      }
      return { result: manifest };
    } catch (error) {
      this.logger.warn(`The result of job ${jobId} could not be read: ${String(error)}`);
      return { note: "The job completed, but its result could not be read." };
    }
  }

  private isAllowed(dataset: string): boolean {
    return this.allowed === null || this.allowed.has(dataset);
  }
}

function failure(use: Anthropic.ToolUseBlockParam, dataset: string | null, message: string): ToolOutcome {
  return {
    block: { type: "tool_result", tool_use_id: use.id, content: message, is_error: true },
    call: { toolUseId: use.id, tool: use.name, dataset, jobId: null },
    reportedJobId: null,
  };
}

function rejectionOf(error: HttpException): string {
  if (!(error instanceof ValidationException)) return error.message;
  return `The parameters were rejected: ${error.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`;
}

export function isFinishedJob(job: Job): boolean {
  return job.state === "completed" || job.state === "failed" || job.state === "cancelled";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
