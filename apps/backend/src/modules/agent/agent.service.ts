import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AgentEvent,
  AreaBox,
  AskBody,
  Chat,
  ChatDetail,
  ChatPage,
  OffsetPaginationQuery,
  UpdateChatBody,
} from "@repo/contracts";
import type { Env } from "../../config/env.schema.js";
import { withErrorCode } from "../../common/errors/with-error-code.js";
import { JobsService } from "../jobs/jobs.service.js";
import { UsersService } from "../users/users.service.js";
import { AgentRepository } from "./agent.repository.js";
import { AgentTools, finished } from "./agent.tools.js";
import { AgentTurnRunner } from "./agent.turns.js";
import { areaBounds, areaSquareMetres } from "./area.js";
import { closeInterrupted, jobUpdate, toEntries, userMessage } from "./agent.messages.js";

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  constructor(
    private readonly repository: AgentRepository,
    private readonly users: UsersService,
    private readonly jobs: JobsService,
    private readonly tools: AgentTools,
    private readonly runner: AgentTurnRunner,
    private readonly config: ConfigService<Env, true>,
  ) {}
  create(userId: string): Promise<Chat> {
    return this.repository.createChat(userId, "New chat");
  }
  list(userId: string, { limit, offset }: OffsetPaginationQuery): Promise<ChatPage> {
    return this.repository.listChats(userId, limit, offset);
  }
  async get(userId: string, id: string): Promise<ChatDetail> {
    const chat = await this.repository.findChat(userId, id);
    if (!chat) throw new NotFoundException("Chat not found");
    const messages = await this.repository.listMessages(id);
    const links = await this.repository.listChatJobs(id);
    const jobs = await Promise.all(links.map((link) => this.jobs.get(userId, link.jobId)));
    const last = messages.findLast((m) => m.kind === "user");
    return {
      ...chat,
      entries: toEntries(messages),
      jobs,
      waitingJobs: links.filter((link) => !link.reported).length,
      area: last ? (last.data as { area: AreaBox | null }).area : null,
    };
  }
  async rename(userId: string, id: string, body: UpdateChatBody): Promise<Chat> {
    const chat = await this.repository.renameChat(userId, id, body);
    if (!chat) throw new NotFoundException("Chat not found");
    return chat;
  }
  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.repository.deleteChat(userId, id))) throw new NotFoundException("Chat not found");
  }
  async ask(
    userId: string,
    chatId: string,
    body: AskBody,
    emit: (e: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const user = await this.users.get(userId);
    if (user.status !== "active") throw new ForbiddenException("Only active accounts can ask questions");
    const chat = await this.repository.findChat(userId, chatId);
    if (!chat) throw new NotFoundException("Chat not found");
    if (body.area && areaSquareMetres(body.area) > this.config.get("AGENT_MAX_AREA_KM2", { infer: true }) * 1_000_000)
      throw new UnprocessableEntityException("The selected area is too large.", withErrorCode("AGENT_AREA_TOO_LARGE"));
    const admission = await this.runner.admitMessage(
      { id: chatId, userId },
      this.config.get("AGENT_QUESTIONS_PER_DAY", { infer: true }),
    );
    switch (admission.status) {
      case "limited":
        throw new HttpException(
          "You have reached the daily question limit.",
          HttpStatus.TOO_MANY_REQUESTS,
          withErrorCode("AGENT_DAILY_LIMIT"),
        );
      case "busy":
        throw new ConflictException("This chat is already answering.", withErrorCode("AGENT_CHAT_BUSY"));
      case "missing":
        throw new NotFoundException("Chat not found");
    }
    const { turnId } = admission;
    // Postgres stores no NUL character in text or JSON.
    const text = body.text.replaceAll("\u0000", "");
    let result: Awaited<ReturnType<AgentTurnRunner["run"]>> | undefined;
    // Once admitted, a failure can no longer be an HTTP error: the stream may be open. It ends the turn instead.
    try {
      signal.throwIfAborted();
      await this.beginTurn(userId, chatId);
      const stored = await this.repository.listMessages(chatId);
      if (!stored.some((message) => message.kind === "user")) {
        const collapsed = text.replace(/\s+/g, " ");
        await this.repository.renameChat(userId, chatId, {
          title: collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed,
        });
      }
      await this.repository.appendMessages(chatId, [
        userMessage(text, body.area, body.area ? areaBounds(body.area) : null),
      ]);
      result = await this.runner.run({ id: chatId, userId }, "message", {
        turnId,
        signal: AbortSignal.any([signal, AbortSignal.timeout(110000)]),
        onEvent: emit,
      });
    } catch (error) {
      if (!signal.aborted) this.logger.error(`Turn ${turnId} failed`, error instanceof Error ? error.stack : error);
      await this.settle(
        this.repository.failTurn(turnId, userId, signal.aborted ? "client_disconnected" : "internal_error"),
      );
    } finally {
      await this.settle(this.repository.releaseTurn(chatId));
    }
    if (signal.aborted) return;
    if (!result || result.outcome === "failed" || result.outcome === "timed_out")
      emit({ type: "error", code: "AGENT_UNAVAILABLE", message: "The assistant could not finish. Try again." });
    else emit({ type: "done", turnId: result.turnId });
  }
  async resumeFinished(): Promise<void> {
    const chats = await this.repository.findChatsWaiting();
    for (let offset = 0; offset < chats.length; offset += 4) {
      await Promise.all(
        chats.slice(offset, offset + 4).map(async (chat) => {
          let claimed = false;
          try {
            // Model turns cost money; an account that cannot ask gets none, and its jobs wait.
            if ((await this.users.get(chat.userId)).status !== "active") return;
            const ids = await this.repository.listUnreportedJobIds(chat.id);
            const jobs = await Promise.all(ids.map((id) => this.jobs.get(chat.userId, id)));
            if (!jobs.some(finished)) return;
            if ((await this.repository.claimTurn(chat.userId, chat.id)) !== "claimed") return;
            claimed = true;
            if (await this.beginTurn(chat.userId, chat.id))
              await this.runner.run(chat, "job_update", { signal: AbortSignal.timeout(110000) });
          } catch (error) {
            this.logger.warn(
              `Resuming chat ${chat.id} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          } finally {
            if (claimed) await this.repository.releaseTurn(chat.id);
          }
        }),
      );
    }
  }
  // Under the chat's lock, before a turn: closes an interrupted turn's tool calls, then stores jobs that ended since.
  private async beginTurn(userId: string, chatId: string): Promise<boolean> {
    const closing = closeInterrupted(await this.repository.listMessages(chatId));
    if (closing.length) await this.repository.appendMessages(chatId, closing);
    return this.deliverFinished(userId, chatId);
  }
  // For cleanup on a path that has already failed or answered: the failure is logged, not thrown.
  private async settle(cleanup: Promise<void>): Promise<void> {
    try {
      await cleanup;
    } catch (error) {
      this.logger.error("Turn cleanup failed", error instanceof Error ? error.stack : error);
    }
  }
  private async deliverFinished(userId: string, chatId: string): Promise<boolean> {
    const ids = await this.repository.listUnreportedJobIds(chatId);
    const jobs = await Promise.all(ids.map((id) => this.jobs.get(userId, id)));
    const ended = jobs.filter(finished);
    if (!ended.length) return false;
    const reports = await Promise.all(ended.map((job) => this.tools.report(userId, job)));
    await this.repository.appendMessages(
      chatId,
      [jobUpdate(reports)],
      ended.map((job) => job.id),
    );
    return true;
  }
}
