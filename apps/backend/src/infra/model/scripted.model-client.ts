import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { ModelClient, ModelUnavailableError, type ModelRequest, type ModelReply } from "./model.client.js";

export class ScriptedModelClient extends ModelClient {
  readonly provider = "scripted";
  readonly model = "scripted";
  private index = 0;
  constructor(private readonly steps: ((request: ModelRequest) => ModelReply)[] = []) {
    super();
  }

  async reply(
    request: ModelRequest,
    opts: { signal: AbortSignal; onText: (delta: string) => void },
  ): Promise<ModelReply> {
    opts.signal.throwIfAborted();
    if (hasUnansweredToolUse(request.messages))
      throw new ModelUnavailableError(
        "A tool_use has no tool_result in the next message",
        "scripted_invalid_request_400",
      );
    const step = this.steps[this.index++];
    const reply = step ? step(request) : defaultReply(request);
    for (const block of reply.content) {
      if (block.type !== "text") continue;
      for (const chunk of block.text.match(/.{1,24}/gs) ?? []) {
        opts.signal.throwIfAborted();
        opts.onText(chunk);
        await Promise.resolve();
      }
    }
    return reply;
  }
}

function defaultReply(request: ModelRequest): ModelReply {
  const last = request.messages.at(-1);
  const blocks =
    typeof last?.content === "string" ? [{ type: "text" as const, text: last.content }] : (last?.content ?? []);
  const result = blocks.find((block) => block.type === "tool_result");
  const words = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  let content: ModelReply["content"];
  let stopReason: ModelReply["stopReason"] = "end_turn";
  if (result?.type === "tool_result") {
    const report = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    content = [{ type: "text", text: describeReport(report) }];
  } else if (words.includes("<job_update>")) {
    content = [
      {
        type: "text",
        text: [...words.matchAll(/<job_update>([\s\S]*?)<\/job_update>/g)]
          .map((match) => describeReport(match[1] ?? ""))
          .join("\n"),
      },
    ];
  } else if (/how many buildings/i.test(words)) {
    content = [{ type: "tool_use", id: `toolu_${randomUUID()}`, name: "run_city", input: {} }];
    stopReason = "tool_use";
  } else
    content = [
      { type: "text", text: "Ask how many buildings are in your drawn area. Phase 1 can run the city dataset." },
    ];
  return {
    content,
    stopReason,
    usage: {
      inputTokens: Math.ceil(JSON.stringify(request).length / 4),
      outputTokens: Math.ceil(JSON.stringify(content).length / 4),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}
function describeReport(text: string): string {
  try {
    const report = JSON.parse(text) as Record<string, unknown>;
    if (typeof report["buildings"] === "number")
      return `There are ${String(report["buildings"])} buildings in this area.`;
    if (report["state"] === "running" || report["state"] === "queued")
      return "The job is running. Its result will be posted in this chat when it finishes.";
    return text;
  } catch {
    return text;
  }
}
// The providers answer 400 to such a history; the stand-in does the same so tests catch it.
function hasUnansweredToolUse(messages: Anthropic.MessageParam[]): boolean {
  return messages.some((message, i) => {
    if (message.role !== "assistant" || typeof message.content === "string") return false;
    const next = messages[i + 1]?.content;
    const answered = new Set(
      typeof next === "string" || !next
        ? []
        : next.flatMap((block) => (block.type === "tool_result" ? block.tool_use_id : [])),
    );
    return message.content.some((block) => block.type === "tool_use" && !answered.has(block.id));
  });
}
