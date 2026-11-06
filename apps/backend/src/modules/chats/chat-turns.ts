import type Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ModelClient, type ModelReply, type ModelUsage } from "../../infra/model/model.client.js";
import {
  assistantMessage,
  notice,
  toModelMessage,
  toModelMessages,
  toolResults,
  type ChatMessage,
} from "./chat-messages.js";
import { ChatTools, type ToolContext } from "./chat-tools.js";
import { ChatsRepository, type ChatTurnRecord } from "./chats.repository.js";
import { systemPrompt } from "./system-prompt.js";

export type ChatTurnTrigger = ChatTurnRecord["trigger"];

// Model requests in one turn; each round of tool calls takes one more.
const maxSteps = 6;

const failedNotice = "The assistant couldn't answer just now. Try again in a moment.";
const refusedNotice = "The assistant declined to answer that.";
const stoppedNotice = "The assistant stopped before it finished answering.";

/** Runs the model on a chat whose turn the caller holds: stores what it answers, and records the turn. */
@Injectable()
export class ChatTurnRunner {
  private readonly logger = new Logger(ChatTurnRunner.name);

  constructor(
    private readonly repository: ChatsRepository,
    private readonly model: ModelClient,
    private readonly tools: ChatTools,
  ) {}

  async run(chat: { id: string; userId: string }, trigger: ChatTurnTrigger): Promise<void> {
    const stored = await this.repository.listMessages(chat.id);
    const messages = toModelMessages(stored);
    const tools = await this.tools.definitions();
    const context: ToolContext = { userId: chat.userId, chatId: chat.id, bounds: latestBounds(stored) };
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let steps = 0;
    let outcome: ChatTurnRecord["outcome"] = "stopped";
    let error: string | null = null;

    try {
      while (steps < maxSteps) {
        steps += 1;
        let reply: ModelReply;
        try {
          reply = await this.model.reply({ system: systemPrompt, tools, messages });
        } catch (failure) {
          outcome = "failed";
          error = failure instanceof Error ? failure.message : String(failure);
          this.logger.warn(`The model failed in chat ${chat.id}: ${error}`);
          await this.repository.appendMessages(chat.id, [notice(failedNotice)]);
          return;
        }
        add(usage, reply.usage);

        // A refusal's partial answer is dropped, so the conversation goes on as if it had not been asked.
        if (reply.stopReason === "refusal") {
          outcome = "refused";
          await this.repository.appendMessages(chat.id, [notice(refusedNotice)]);
          return;
        }

        const uses = reply.content.filter((block): block is Anthropic.ToolUseBlockParam => block.type === "tool_use");
        if (reply.stopReason !== "tool_use" || uses.length === 0) {
          // Without a tool_use stop, a tool call was cut off and will get no result, which the API would refuse.
          const content = reply.content.filter((block) => block.type !== "tool_use");
          if (content.length > 0) await this.repository.appendMessages(chat.id, [assistantMessage(content)]);
          outcome = "answered";
          return;
        }

        // Every call in a reply runs at once, and their results go back together in one message.
        const outcomes = await Promise.all(uses.map((use) => this.tools.run(context, use)));
        const step = [assistantMessage(reply.content), toolResults(outcomes)];
        const reported = outcomes.flatMap((result) => result.reportedJobId ?? []);
        await this.repository.appendMessages(chat.id, step, reported);
        messages.push(...step.flatMap((message) => toModelMessage(message) ?? []));
      }
      await this.repository.appendMessages(chat.id, [notice(stoppedNotice)]);
    } finally {
      await this.repository.insertTurn({
        userId: chat.userId,
        chatId: chat.id,
        trigger,
        outcome,
        steps,
        ...usage,
        error,
      });
    }
  }
}

function latestBounds(messages: ChatMessage[]) {
  return messages.findLast((message) => message.kind === "user_message")?.data.bounds ?? null;
}

function add(total: ModelUsage, more: ModelUsage): void {
  total.inputTokens += more.inputTokens;
  total.outputTokens += more.outputTokens;
  total.cacheReadTokens += more.cacheReadTokens;
  total.cacheWriteTokens += more.cacheWriteTokens;
}
