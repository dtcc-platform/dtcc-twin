import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Chat, ChatMessageBody, ChatPage, OffsetPaginationQuery } from "@repo/contracts";
import { JobsService } from "../jobs/jobs.service.js";
import { UsersService } from "../users/users.service.js";
import { toEntries, userMessage } from "./chat-messages.js";
import { ChatTurnRunner } from "./chat-turns.js";
import { ChatsRepository, type StoredChat } from "./chats.repository.js";

const titleLength = 80;

@Injectable()
export class ChatsService {
  constructor(
    private readonly repository: ChatsRepository,
    private readonly turns: ChatTurnRunner,
    private readonly users: UsersService,
    private readonly jobs: JobsService,
  ) {}

  async list(userId: string, { limit, offset }: OffsetPaginationQuery): Promise<ChatPage> {
    const { chats, total } = await this.repository.findPage(userId, limit, offset);
    return { items: chats, limit, offset, total };
  }

  async get(userId: string, id: string): Promise<Chat> {
    const chat = await this.repository.findById(userId, id);
    if (!chat) throw new NotFoundException(`Chat ${id} not found`);
    const [messages, links] = await Promise.all([this.repository.listMessages(id), this.repository.listJobLinks(id)]);
    const jobs = await Promise.all(links.map((link) => this.jobs.get(userId, link.jobId)));
    return { ...chat, entries: toEntries(messages), jobs, waitingJobs: links.filter((link) => !link.reported).length };
  }

  /** Starts a chat with its first message, and answers it. */
  async create(userId: string, body: ChatMessageBody): Promise<Chat> {
    await this.ensureActive(userId);
    const chat = await this.repository.insertClaimed(userId, titleOf(body.text));
    await this.answer(chat, body);
    return this.get(userId, chat.id);
  }

  /** Adds the user's message to the chat and answers it; refused while another turn holds the chat. */
  async post(userId: string, id: string, body: ChatMessageBody): Promise<Chat> {
    await this.ensureActive(userId);
    const claim = await this.repository.claimTurn(userId, id);
    if (claim === "missing") throw new NotFoundException(`Chat ${id} not found`);
    if (claim === "busy") throw new ConflictException("The assistant is still answering in this chat");
    await this.answer({ id, userId }, body);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(userId, id);
    if (!deleted) throw new NotFoundException(`Chat ${id} not found`);
  }

  // The caller holds the chat's turn; it is released however the turn ends.
  private async answer(chat: Pick<StoredChat, "id" | "userId">, body: ChatMessageBody): Promise<void> {
    try {
      await this.repository.appendMessages(chat.id, [userMessage(body.text, body.bounds)]);
      await this.turns.run(chat, "message");
    } finally {
      await this.repository.releaseTurn(chat.id);
    }
  }

  // Every turn costs model tokens, so only accounts an admin has approved may chat, as for jobs.
  private async ensureActive(userId: string): Promise<void> {
    const user = await this.users.get(userId);
    if (user.status !== "active") throw new ForbiddenException("Only active accounts can chat");
  }
}

function titleOf(text: string): string {
  const firstLine = (text.split("\n", 1)[0] ?? "").trim();
  return firstLine.length > titleLength ? `${firstLine.slice(0, titleLength - 1)}…` : firstLine;
}
