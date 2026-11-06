import { Injectable, Logger } from "@nestjs/common";
import { ModelClient, type ModelReply, type ModelUsage } from "../../infra/model/model.client.js";
import { assistantMessage, notice, toModelMessages } from "./chat-messages.js";
import { ChatsRepository, type ChatTurnRecord } from "./chats.repository.js";
import { systemPrompt } from "./system-prompt.js";

export type ChatTurnTrigger = ChatTurnRecord["trigger"];

const failedNotice = "The assistant couldn't answer just now. Try again in a moment.";
const refusedNotice = "The assistant declined to answer that.";

/** Runs the model on a chat whose turn the caller holds: stores what it answers, and records the turn. */
@Injectable()
export class ChatTurnRunner {
  private readonly logger = new Logger(ChatTurnRunner.name);

  constructor(
    private readonly repository: ChatsRepository,
    private readonly model: ModelClient,
  ) {}

  async run(chat: { id: string; userId: string }, trigger: ChatTurnTrigger): Promise<void> {
    const messages = toModelMessages(await this.repository.listMessages(chat.id));
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let outcome: ChatTurnRecord["outcome"] = "failed";
    let error: string | null = null;

    try {
      let reply: ModelReply;
      try {
        reply = await this.model.reply({ system: systemPrompt, tools: [], messages });
      } catch (failure) {
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
      if (reply.content.length > 0) await this.repository.appendMessages(chat.id, [assistantMessage(reply.content)]);
      outcome = "answered";
    } finally {
      await this.repository.insertTurn({
        userId: chat.userId,
        chatId: chat.id,
        trigger,
        outcome,
        steps: 1,
        ...usage,
        error,
      });
    }
  }
}

function add(total: ModelUsage, more: ModelUsage): void {
  total.inputTokens += more.inputTokens;
  total.outputTokens += more.outputTokens;
  total.cacheReadTokens += more.cacheReadTokens;
  total.cacheWriteTokens += more.cacheWriteTokens;
}
