import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Chat, ChatMessageBody, ChatPage, Job, OffsetPaginationQuery } from "@repo/contracts";
import type { Env } from "../../config/env.schema.js";
import { JobsService } from "../jobs/jobs.service.js";
import { UsersService } from "../users/users.service.js";
import { jobUpdate, toEntries, userMessage } from "./chat-messages.js";
import { ChatTools, isFinishedJob } from "./chat-tools.js";
import { ChatTurnRunner } from "./chat-turns.js";
import { ChatsRepository, type StoredChat } from "./chats.repository.js";

type ChatRef = Pick<StoredChat, "id" | "userId">;

const titleLength = 80;
// Chats one watcher run resumes at once; each runs a turn of the model.
const resumeConcurrency = 4;

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);
  private readonly turnsPerDay: number;

  constructor(
    private readonly repository: ChatsRepository,
    private readonly turns: ChatTurnRunner,
    private readonly tools: ChatTools,
    private readonly users: UsersService,
    private readonly jobs: JobsService,
    config: ConfigService<Env, true>,
  ) {
    this.turnsPerDay = config.get("CHAT_TURNS_PER_DAY", { infer: true });
  }

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
    await this.ensureCanChat(userId);
    const chat = await this.repository.insertClaimed(userId, titleOf(body.text));
    await this.answer(chat, body);
    return this.get(userId, chat.id);
  }

  /** Adds the user's message to the chat and answers it; refused while another turn holds the chat. */
  async post(userId: string, id: string, body: ChatMessageBody): Promise<Chat> {
    await this.ensureCanChat(userId);
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

  /**
   * Tells every waiting chat how its jobs ended, each in a turn of its own: one run of the watcher. A chat whose turn
   * is held is left for the next run, and a chat that fails doesn't stop the others.
   */
  async resumeFinished(): Promise<void> {
    const waiting = await this.repository.findWaitingChats();
    for (let start = 0; start < waiting.length; start += resumeConcurrency) {
      const batch = waiting.slice(start, start + resumeConcurrency);
      const results = await Promise.allSettled(batch.map((chat) => this.resume(chat)));
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          this.logger.error(`Resuming chat ${batch[index]?.id ?? ""} failed: ${String(result.reason)}`);
        }
      });
    }
  }

  // The caller holds the chat's turn; it is released however the turn ends.
  private async answer(chat: ChatRef, body: ChatMessageBody): Promise<void> {
    try {
      // A job that ended since the last turn is told first, so the model reads the user's words knowing it.
      await this.deliverFinished(chat);
      await this.repository.appendMessages(chat.id, [userMessage(body.text, body.bounds)]);
      await this.turns.run(chat, "message");
    } finally {
      await this.repository.releaseTurn(chat.id);
    }
  }

  private async resume(chat: ChatRef): Promise<void> {
    // Checked before claiming, so a chat whose jobs all still run is never locked against its user.
    if ((await this.finishedJobs(chat)).length === 0) return;
    if ((await this.repository.claimTurn(chat.userId, chat.id)) !== "claimed") return;
    try {
      if (await this.deliverFinished(chat)) await this.turns.run(chat, "job_update");
    } finally {
      await this.repository.releaseTurn(chat.id);
    }
  }

  /**
   * Stores one update telling the model how every job it is waiting on in this chat ended, if any has, and marks them
   * reported with it. The caller holds the chat's turn. The update stays even if no turn answers it.
   */
  private async deliverFinished(chat: ChatRef): Promise<boolean> {
    const finished = await this.finishedJobs(chat);
    if (finished.length === 0) return false;
    const reports = await Promise.all(finished.map((job) => this.tools.report(chat.userId, job)));
    await this.repository.appendMessages(
      chat.id,
      [jobUpdate(reports)],
      finished.map((job) => job.id),
    );
    return true;
  }

  // Job states come from the database, which the jobs watcher keeps up to date with the engine.
  private async finishedJobs(chat: ChatRef): Promise<Job[]> {
    const ids = await this.repository.listWaitingJobIds(chat.id);
    const jobs = await Promise.all(ids.map((id) => this.jobs.get(chat.userId, id)));
    return jobs.filter(isFinishedJob);
  }

  // Every turn costs model tokens: only accounts an admin has approved may chat, as for jobs, and only so much a day.
  private async ensureCanChat(userId: string): Promise<void> {
    const user = await this.users.get(userId);
    if (user.status !== "active") throw new ForbiddenException("Only active accounts can chat");
    if ((await this.repository.countMessageTurnsOfLastDay(userId)) >= this.turnsPerDay) {
      throw new HttpException(
        `You have sent ${String(this.turnsPerDay)} messages in the last 24 hours, the most allowed. Try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

function titleOf(text: string): string {
  const firstLine = (text.split("\n", 1)[0] ?? "").trim();
  return firstLine.length > titleLength ? `${firstLine.slice(0, titleLength - 1)}…` : firstLine;
}
