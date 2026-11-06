import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { ModelClient, ModelUnavailableError, type ModelReply, type ModelRequest } from "./model.client.js";

/**
 * Stands in for the chat model with a fixed script, so a chat runs end to end without Bedrock. Like a real model it
 * reads only the request: it calls the tool of every Dataset the user names, looks up the latest job when asked
 * whether it is done, and answers tool results and job updates from what they say. `[fail]` in the user's words makes
 * it fail as an unreachable model does, `[refuse]` refuse.
 */
@Injectable()
export class ScriptedModel extends ModelClient {
  private readonly delayMs: number;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.delayMs = config.get("SCRIPTED_MODEL_DELAY_MS", { infer: true });
  }

  async reply(request: ModelRequest): Promise<ModelReply> {
    if (this.delayMs > 0) await sleep(this.delayMs);
    return scriptedReply(request);
  }
}

export function scriptedReply(request: ModelRequest): ModelReply {
  const last = request.messages.at(-1);
  const results = last?.role === "user" ? toolResultsOf(last) : [];
  if (results.length > 0) return replyWith(request, [text(results.map(describeResult).join("\n"))], "end_turn");

  // It answers the job updates since its last answer and the latest message's words; a turn for an update alone has
  // no words, so it runs nothing again.
  const unanswered = request.messages.slice(
    request.messages.findLastIndex((message) => message.role === "assistant") + 1,
  );
  const updates = unanswered.flatMap(jobUpdatesOf).map(describeJob);
  const words = last ? userWordsIn([last]) : "";
  if (words.includes("[fail]")) throw new ModelUnavailableError("The scripted model was told to fail");
  if (words.includes("[refuse]")) return replyWith(request, [], "refusal");
  if (!words) return replyWith(request, [text(updates.join("\n"))], "end_turn");

  const before = updates.map((update) => `${update}\n`).join("");
  const calls = toolCallsFor(words, request);
  if (calls.length > 0) {
    const names = calls.map((call) => call.name).join(", ");
    return replyWith(request, [text(`${before}Let me call ${names}.`), ...calls], "tool_use");
  }
  return replyWith(request, [text(`${before}You said: "${words}". ${areaNote(request.messages)}`)], "end_turn");
}

function replyWith(
  request: ModelRequest,
  content: Anthropic.ContentBlockParam[],
  stopReason: Anthropic.StopReason,
): ModelReply {
  return {
    content,
    stopReason,
    // About four characters a token, which is all a stand-in needs for turn records and spend limits.
    usage: {
      inputTokens: Math.ceil(JSON.stringify(request).length / 4),
      outputTokens: Math.ceil(JSON.stringify(content).length / 4),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}

function text(value: string): Anthropic.TextBlockParam {
  return { type: "text", text: value };
}

function toolUse(name: string, input: Record<string, unknown>): Anthropic.ToolUseBlockParam {
  return { type: "tool_use", id: `toolu_scripted_${randomUUID().replaceAll("-", "")}`, name, input };
}

function toolCallsFor(words: string, request: ModelRequest): Anthropic.ToolUseBlockParam[] {
  const lower = words.toLowerCase();
  const datasets = request.tools.filter((tool) => tool.name.startsWith("run_") && mentions(lower, tool));
  if (datasets.length > 0) return datasets.map((tool) => toolUse(tool.name, {}));

  const canLookUp = request.tools.some((tool) => tool.name === "get_job");
  const jobId = latestJobId(request.messages);
  if (canLookUp && jobId && /\b(done|finished|ready|status)\b/.test(lower))
    return [toolUse("get_job", { job_id: jobId })];
  return [];
}

// A Dataset is named by its name ("air_quality" or "air quality"), its singular, or its title, the description's start.
function mentions(lower: string, tool: Anthropic.Tool): boolean {
  const name = tool.name.slice("run_".length).replaceAll("_", " ");
  const title = (tool.description ?? "").split(". ", 1)[0]?.toLowerCase() ?? "";
  const names = [name, name.replace(/s$/, ""), title].filter((candidate) => candidate.length > 2);
  return names.some((candidate) => new RegExp(`\\b${escapeRegExp(candidate)}`).test(lower));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toolResultsOf(message: Anthropic.MessageParam): Anthropic.ToolResultBlockParam[] {
  if (typeof message.content === "string") return [];
  const blocks: Anthropic.ContentBlockParam[] = message.content;
  return blocks.filter((block): block is Anthropic.ToolResultBlockParam => block.type === "tool_result");
}

function resultText(block: Anthropic.ToolResultBlockParam): string {
  if (typeof block.content === "string") return block.content;
  return (block.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

function describeResult(block: Anthropic.ToolResultBlockParam): string {
  const content = resultText(block);
  if (block.is_error) return `I couldn't do that: ${content}`;
  const report = parseObject(content);
  if (!report) return content;
  return describeJob(report);
}

/** A job's report, as a tool result or a job update carries it, in a sentence. */
function describeJob(report: Record<string, unknown>): string {
  const dataset = typeof report["dataset"] === "string" ? report["dataset"] : "The job";
  switch (report["state"]) {
    case "queued":
    case "running":
      return `${dataset} is running on DTCC Engine; I'll post the result here when it finishes.`;
    case "completed":
      return `${dataset} finished. ${describeManifest(report["result"])}`.trim();
    case "failed":
      return `${dataset} failed: ${typeof report["error"] === "string" ? report["error"] : "no reason given"}.`;
    case "cancelled":
      return `${dataset} was cancelled.`;
    default:
      return JSON.stringify(report);
  }
}

// What a real model would read first in a manifest: its headline, and any facts Core summarized.
function describeManifest(manifest: unknown): string {
  if (!isRecord(manifest)) return "Its result could not be read.";
  const presentation = isRecord(manifest["presentation"]) ? manifest["presentation"] : {};
  const headline = typeof presentation["headline"] === "string" ? `${presentation["headline"]}.` : "";
  const summary = isRecord(manifest["summary"]) ? manifest["summary"] : {};
  const facts = Object.entries(summary).map(([key, value]) => `${key}: ${String(value)}`);
  return [headline, facts.length > 0 ? `${facts.join(", ")}.` : "It reports no figures."].join(" ").trim();
}

function latestJobId(messages: Anthropic.MessageParam[]): string | undefined {
  for (const message of messages.toReversed()) {
    for (const block of toolResultsOf(message).toReversed()) {
      const jobId = parseObject(resultText(block))?.["job_id"];
      if (typeof jobId === "string") return jobId;
    }
  }
  return undefined;
}

// The app's own blocks in a user message, such as the map context, are tagged; the user's words are not.
function isAppBlock(value: string): boolean {
  return /^<[a-z_]+>/.test(value);
}

function textBlocks(message: Anthropic.MessageParam): string[] {
  if (typeof message.content === "string") return [message.content];
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
}

function userWordsIn(messages: Anthropic.MessageParam[]): string {
  return messages
    .flatMap((message) => (message.role === "user" ? textBlocks(message) : []))
    .filter((block) => !isAppBlock(block))
    .join("\n");
}

function jobUpdatesOf(message: Anthropic.MessageParam): Record<string, unknown>[] {
  if (message.role !== "user") return [];
  return textBlocks(message).flatMap((block) => {
    const body = /^<job_update>\n([\s\S]*)\n<\/job_update>$/.exec(block)?.[1];
    const report = body === undefined ? undefined : parseObject(body);
    return report ? [report] : [];
  });
}

function areaNote(messages: Anthropic.MessageParam[]): string {
  const context = messages
    .flatMap((message) => (message.role === "user" ? textBlocks(message) : []))
    .findLast((block) => block.startsWith("<map_context>"));
  const size = context && /([\d.]+ km²)/.exec(context)?.[1];
  return size ? `I can see the area you selected (${size}).` : "No area is selected on the map.";
}

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
