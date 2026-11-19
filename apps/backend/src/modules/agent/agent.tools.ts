import { setTimeout as sleep } from "node:timers/promises";
import { z, ZodError } from "zod";
import { EngineUnavailableError } from "../../infra/engine/engine.errors.js";
import { readPackage } from "./readers/package-reader.js";
import { READERS } from "./readers/readers.js";
import type Anthropic from "@anthropic-ai/sdk";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Job } from "@repo/contracts";
import type { Env } from "../../config/env.schema.js";
import { DatasetsService } from "../datasets/datasets.service.js";
import { JobsService } from "../jobs/jobs.service.js";
import { AgentRepository } from "./agent.repository.js";
import type { SwerefBounds } from "./area.js";
export type JobReport = {
  job_id: string;
  dataset: string;
  state: Job["state"];
  progress?: Job["progress"];
  note?: string;
  error?: string | null;
  headline?: unknown;
  summary?: unknown;
  warnings?: unknown;
  buildings?: number;
};
export type ToolContext = {
  userId: string;
  chatId: string;
  bounds: SwerefBounds | null;
  signal: AbortSignal;
  status: (message: string) => void;
  jobStarted: (jobId: string, dataset: string) => void;
};
export type ToolOutcome = {
  block: Anthropic.ToolResultBlockParam;
  call: { toolUseId: string; tool: string; dataset: string | null; jobId: string | null };
  reportedJobId: string | null;
};
@Injectable()
export class AgentTools {
  private readonly logger = new Logger(AgentTools.name);
  constructor(
    private readonly jobs: JobsService,
    private readonly datasets: DatasetsService,
    private readonly repository: AgentRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}
  private enabled(name: string): boolean {
    return (
      this.config
        .get("AGENT_DATASETS", { infer: true })
        .split(",")
        .map((s) => s.trim())
        .includes(name) && /^run_[a-z0-9_]{1,60}$/.test(`run_${name}`)
    );
  }
  async definitions(): Promise<Anthropic.Tool[]> {
    let tools: Anthropic.Tool[] = [];
    try {
      const { items } = await this.datasets.list();
      tools = items
        .filter((d) => this.enabled(d.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => {
          const original = z.record(z.string(), z.unknown()).parse(d.argsSchema["properties"] ?? {});
          const properties = Object.fromEntries(
            Object.entries(original).filter(([key]) => key !== "bounds" && key !== "format"),
          );
          const required = z
            .array(z.string())
            .parse(d.argsSchema["required"] ?? [])
            .filter((key) => key !== "bounds" && key !== "format");
          return {
            name: `run_${d.name}`,
            description: d.description,
            input_schema: { ...d.argsSchema, type: "object", properties, required },
          };
        });
    } catch (error) {
      if (!(error instanceof EngineUnavailableError)) throw error;
    }
    return [
      ...tools,
      {
        name: "get_job",
        description: "Read one of your jobs",
        input_schema: {
          type: "object",
          properties: { job_id: { type: "string" } },
          required: ["job_id"],
          additionalProperties: false,
        },
      },
      {
        name: "list_available_data",
        description: "List all Engine datasets and which can run now",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
  }
  async run(ctx: ToolContext, use: Anthropic.ToolUseBlockParam): Promise<ToolOutcome> {
    const call: ToolOutcome["call"] = { toolUseId: use.id, tool: use.name, dataset: null, jobId: null };
    const outcome = (value: unknown, error = false, reportedJobId: string | null = null): ToolOutcome => ({
      block: {
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(value),
        ...(error ? { is_error: true } : {}),
      },
      call,
      reportedJobId,
    });
    try {
      ctx.signal.throwIfAborted();
      if (use.name === "list_available_data") {
        const { items } = await this.datasets.list();
        return outcome(
          items.map((d) => ({
            name: d.name,
            title: d.title,
            description: d.description,
            availability: this.enabled(d.name) ? "can run now" : "not yet",
          })),
        );
      }
      let job: Job;
      if (use.name === "get_job") {
        const { job_id } = z.strictObject({ job_id: z.uuid() }).parse(use.input);
        job = await this.jobs.get(ctx.userId, job_id);
        call.jobId = job.id;
        call.dataset = job.dataset;
      } else {
        const dataset = use.name.startsWith("run_") ? use.name.slice(4) : "";
        if (!this.enabled(dataset)) return outcome("This tool is not available in phase 1.", true);
        if (!ctx.bounds) return outcome("Draw an area on the map first.", true);
        const input = z.record(z.string(), z.unknown()).parse(use.input);
        if ("bounds" in input || "format" in input)
          return outcome("The app supplies the area and package format.", true);
        const parameters = { ...input, bounds: ctx.bounds };
        const reusable = await this.repository.findReusableJob(ctx.userId, dataset, parameters);
        const candidate = reusable ? await this.jobs.get(ctx.userId, reusable) : null;
        const reused = candidate && candidate.state !== "failed" && candidate.state !== "cancelled" ? candidate : null;
        job = reused ?? (await this.jobs.create(ctx.userId, { dataset, parameters }));
        call.jobId = job.id;
        call.dataset = dataset;
        await this.repository.linkJob(ctx.chatId, job.id, dataset, parameters);
        ctx.jobStarted(job.id, dataset);
        ctx.status(
          reused
            ? `Using an earlier ${(await this.datasets.list()).items.find((d) => d.name === dataset)?.title ?? dataset} result…`
            : `Running ${dataset} for your area…`,
        );
        const deadline = Date.now() + this.config.get("AGENT_JOB_WAIT_MS", { infer: true });
        for (;;) {
          ctx.signal.throwIfAborted();
          job = await this.jobs.get(ctx.userId, job.id);
          if (finished(job) || Date.now() >= deadline) break;
          await sleep(Math.min(2000, deadline - Date.now()), undefined, { signal: ctx.signal });
        }
      }
      const report = await this.report(ctx.userId, job);
      return outcome(report, job.state === "failed" || job.state === "cancelled", finished(job) ? job.id : null);
    } catch (error) {
      ctx.signal.throwIfAborted();
      this.logger.warn(`Tool ${use.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      return outcome(failureSentence(error), true);
    }
  }
  async report(userId: string, job: Job): Promise<JobReport> {
    const report: JobReport = { job_id: job.id, dataset: job.dataset, state: job.state };
    if (!finished(job))
      return {
        ...report,
        progress: job.progress,
        note: "The result will be posted in this chat when the job finishes.",
      };
    if (job.state !== "completed") return { ...report, error: job.error };
    try {
      const reader = READERS[job.dataset];
      const { presentation, model } = await readPackage(
        (await this.jobs.package(userId, job.id)).content,
        this.config.get("AGENT_MAX_MODEL_MB", { infer: true }) * 1024 * 1024,
        reader !== undefined,
      );
      return { ...report, ...presentation, ...(reader && model ? reader(model) : {}) };
    } catch {
      return { ...report, note: "The job completed, but its result could not be read." };
    }
  }
}
export function finished(job: Job): boolean {
  return job.state === "completed" || job.state === "failed" || job.state === "cancelled";
}
// The model sees a fixed sentence per kind of failure; the detail, which can hold internal text, is only logged.
function failureSentence(error: unknown): string {
  if (error instanceof EngineUnavailableError)
    return "Engine is unavailable right now, so the job could not be started or read.";
  if (error instanceof ZodError) return "The tool input was not valid.";
  if (error instanceof NotFoundException) return "No such job was found.";
  if (error instanceof BadRequestException) return "Engine did not accept the job's parameters.";
  if (error instanceof ForbiddenException) return "This account cannot run jobs.";
  // JobLimit's message is the app's own: the hourly limit and the minutes until it resets.
  if (error instanceof HttpException && error.getStatus() === 429) return error.message;
  if (error instanceof ServiceUnavailableException)
    return "Jobs cannot be started right now. Try again in a few minutes.";
  return "The tool could not complete.";
}
