import type Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import type { AgentEvent } from "@repo/contracts";
import { ModelClient, ModelUnavailableError, type ModelUsage } from "../../infra/model/model.client.js";
import { modelCost } from "../../infra/model/model.cost.js";
import { AgentRepository, type Admission, type TurnRecord } from "./agent.repository.js";
import { AgentTools, type ToolOutcome } from "./agent.tools.js";
import { assistantMessage, closingResults, notice, storable, toModelMessages, toolResults } from "./agent.messages.js";
import { SYSTEM_PROMPT, PROMPT_VERSION } from "./agent.prompt.js";
import type { SwerefBounds } from "./area.js";

@Injectable()
export class AgentTurnRunner {
  constructor(
    private readonly repository: AgentRepository,
    private readonly model: ModelClient,
    private readonly tools: AgentTools,
  ) {}
  admitMessage(chat: { id: string; userId: string }, limit: number): Promise<Admission> {
    return this.repository.reserveMessageTurn(chat.userId, chat.id, limit, {
      provider: this.model.provider,
      model: this.model.model,
      promptVersion: PROMPT_VERSION,
    });
  }
  async run(
    chat: { id: string; userId: string },
    trigger: "message" | "job_update",
    opts: { signal: AbortSignal; turnId?: string; onEvent?: (e: AgentEvent) => void },
  ): Promise<{ turnId: string; outcome: TurnRecord["outcome"] }> {
    const initial: TurnRecord = {
      chatId: chat.id,
      userId: chat.userId,
      trigger,
      outcome: "running",
      provider: this.model.provider,
      model: this.model.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: "0",
      modelCalls: 0,
      jobIds: [],
      durationMs: 0,
      errorCode: null,
    };
    const turnId = opts.turnId ?? (await this.repository.insertTurn(initial));
    const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(110000)]);
    const started = performance.now();
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const jobIds = new Set<string>();
    let calls = 0;
    let outcome: TurnRecord["outcome"] = "stopped";
    let errorCode: string | null = null;
    let open: Anthropic.ToolUseBlockParam[] = [];
    const results: ToolOutcome[] = [];
    const startedJobs = new Map<string, { jobId: string; dataset: string }>();
    let currentTool = "";
    const emit = (e: AgentEvent): void => {
      if (!signal.aborted) opts.onEvent?.(e);
    };
    try {
      const stored = await this.repository.listMessages(chat.id);
      if (trigger === "job_update") {
        const update = stored.findLast((message) => message.kind === "job_update");
        if (update) for (const job of (update.data as { jobs: { jobId: string }[] }).jobs) jobIds.add(job.jobId);
      }
      const latest = stored.findLast((m) => m.kind === "user");
      const bounds = latest ? (latest.data as { bounds: SwerefBounds | null }).bounds : null;
      const definitions = await this.tools.definitions();
      const tools = definitions.map((tool, i) =>
        i === definitions.length - 1 ? { ...tool, cache_control: { type: "ephemeral" as const } } : tool,
      );
      emit({ type: "status", message: "Thinking…" });
      for (; calls < 6;) {
        signal.throwIfAborted();
        const messages = cachedHistory(toModelMessages(await this.repository.listMessages(chat.id)));
        calls++;
        const reply = await this.model.reply(
          { system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }], tools, messages },
          {
            signal,
            onText: (delta) => {
              emit({ type: "text", delta });
            },
          },
        );
        for (const key of Object.keys(usage) as (keyof ModelUsage)[]) usage[key] += reply.usage[key];
        if (reply.stopReason === "refusal") {
          outcome = "refused";
          await this.repository.appendMessages(chat.id, [notice("The assistant declined to answer that question.")]);
          break;
        }
        const content = storable(reply.content);
        if (!content) {
          outcome = "failed";
          errorCode = "invalid_model_output";
          await this.repository.appendMessages(chat.id, [
            notice("The assistant could not answer just now. Try again."),
          ]);
          break;
        }
        const uses = content.filter((block): block is Anthropic.ToolUseBlockParam => block.type === "tool_use");
        if (reply.stopReason === "max_tokens") {
          errorCode = "max_tokens";
          await this.repository.appendMessages(chat.id, [
            assistantMessage(content),
            ...(uses.length ? [closingResults(uses, "The answer reached its length limit before this tool ran.")] : []),
            notice("The answer reached its length limit. Try a shorter question."),
          ]);
          break;
        }
        open = uses;
        await this.repository.appendMessages(chat.id, [assistantMessage(content)]);
        if (!open.length) {
          outcome = "answered";
          break;
        }
        results.length = 0;
        for (const use of open) {
          signal.throwIfAborted();
          currentTool = use.id;
          const result = await this.tools.run(
            {
              userId: chat.userId,
              chatId: chat.id,
              bounds,
              signal,
              status: (message) => {
                emit({ type: "status", message });
              },
              jobStarted: (jobId, dataset) => {
                jobIds.add(jobId);
                startedJobs.set(currentTool, { jobId, dataset });
                emit({ type: "job", jobId, dataset });
              },
            },
            use,
          );
          if (result.call.jobId) jobIds.add(result.call.jobId);
          results.push(result);
        }
        await this.repository.appendMessages(
          chat.id,
          [toolResults(results)],
          results.flatMap((result) => result.reportedJobId ?? []),
        );
        open = [];
      }
      if (outcome === "stopped" && !errorCode)
        await this.repository.appendMessages(chat.id, [notice("The assistant stopped after reaching its tool limit.")]);
    } catch (error) {
      outcome = "failed";
      errorCode = signal.aborted
        ? signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
          ? "timed_out"
          : "client_disconnected"
        : error instanceof ModelUnavailableError
          ? error.errorCode
          : "agent_unavailable";
      if (open.length) {
        const closing = open.map(
          (use) =>
            results.find((result) => result.block.tool_use_id === use.id) ?? {
              block: {
                type: "tool_result" as const,
                tool_use_id: use.id,
                content: "The turn stopped before this tool finished. Any started job will be reported later.",
                is_error: true,
              },
              call: {
                toolUseId: use.id,
                tool: use.name,
                dataset: startedJobs.get(use.id)?.dataset ?? null,
                jobId: startedJobs.get(use.id)?.jobId ?? null,
              },
              reportedJobId: null,
            },
        );
        await this.repository.appendMessages(
          chat.id,
          [toolResults(closing)],
          closing.flatMap((result) => result.reportedJobId ?? []),
        );
      }
      await this.repository.appendMessages(chat.id, [
        notice(
          errorCode === "client_disconnected"
            ? "The connection closed. Started jobs will continue."
            : errorCode === "timed_out"
              ? "The answer timed out. Started jobs will continue."
              : "The assistant could not answer just now. Try again.",
        ),
      ]);
    }
    await this.repository.updateTurn(turnId, {
      chatId: chat.id,
      userId: chat.userId,
      trigger,
      outcome,
      provider: this.model.provider,
      model: this.model.model,
      promptVersion: PROMPT_VERSION,
      ...usage,
      costUsd: nullableString(modelCost(this.model.provider, this.model.model, usage)),
      modelCalls: calls,
      jobIds: [...jobIds],
      durationMs: Math.round(performance.now() - started),
      errorCode,
    });
    return { turnId, outcome };
  }
}
function cachedHistory(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((message, index) => {
    if (index !== messages.length - 1 || message.role === "system") return message;
    const blocks =
      typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
    return {
      ...message,
      content: blocks.map((block, i) =>
        i === blocks.length - 1 ? { ...block, cache_control: { type: "ephemeral" as const } } : block,
      ),
    };
  });
}
function nullableString(value: number | null): string | null {
  return value === null ? null : String(value);
}
