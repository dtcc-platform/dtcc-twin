import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, desc, eq, inArray, isNull, lt, max, or, sql } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import { agentChats, agentMessages, agentChatJobs, agentTurns } from "./agent.table.js";
import { Injectable } from "@nestjs/common";
import type { Chat, ChatPage, UpdateChatBody } from "@repo/contracts";
export type NewAgentMessage = {
  kind: "user" | "assistant" | "tool_results" | "job_update" | "notice";
  content: unknown;
  data: unknown;
};
export type AgentMessage = NewAgentMessage & { id: string; seq: number; createdAt: string };
export type TurnRecord = {
  chatId: string | null;
  userId: string;
  trigger: "message" | "job_update";
  outcome: "running" | "answered" | "refused" | "failed" | "timed_out" | "stopped";
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: string | null;
  modelCalls: number;
  jobIds: string[];
  durationMs: number;
  errorCode: string | null;
};
export type StoredChat = Chat & { answering: boolean };
export type Claim = "claimed" | "busy" | "missing";
export type Admission = { status: "admitted"; turnId: string } | { status: "limited" | Exclude<Claim, "claimed"> };
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
@Injectable()
export class AgentRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async createChat(userId: string, title: string): Promise<Chat> {
    const [row] = await this.db.insert(agentChats).values({ userId, title }).returning();
    if (!row) throw new Error("Chat insert returned no row");
    return toChat(row);
  }
  async listChats(userId: string, limit: number, offset: number): Promise<ChatPage> {
    const owned = eq(agentChats.userId, userId);
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(agentChats)
        .where(owned)
        .orderBy(desc(agentChats.createdAt), desc(agentChats.id))
        .limit(limit)
        .offset(offset),
      this.db.$count(agentChats, owned),
    ]);
    return { items: rows.map(toChat), total, limit, offset };
  }
  async findChat(userId: string, id: string): Promise<StoredChat | null> {
    const [row] = await this.db
      .select({
        chat: agentChats,
        answering: sql<boolean>`coalesce(${agentChats.turnStartedAt} >= now() - interval '10 minutes', false)`,
      })
      .from(agentChats)
      .where(and(eq(agentChats.userId, userId), eq(agentChats.id, id)));
    return row ? { ...toChat(row.chat), answering: row.answering } : null;
  }
  async renameChat(userId: string, id: string, body: UpdateChatBody): Promise<Chat | null> {
    if (body.title === undefined) return this.findChat(userId, id);
    const [row] = await this.db
      .update(agentChats)
      .set({ title: body.title })
      .where(and(eq(agentChats.userId, userId), eq(agentChats.id, id)))
      .returning();
    return row ? toChat(row) : null;
  }
  async deleteChat(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(agentChats)
      .where(and(eq(agentChats.userId, userId), eq(agentChats.id, id)))
      .returning({ id: agentChats.id });
    return rows.length > 0;
  }
  claimTurn(userId: string, chatId: string): Promise<Claim> {
    return this.db.transaction((tx) => this.claim(tx, userId, chatId));
  }
  // Taking a lock that expired means the turn that held it died: its running turns are failed, not left running.
  private async claim(tx: Transaction, userId: string, chatId: string): Promise<Claim> {
    const [row] = await tx
      .update(agentChats)
      .set({ turnStartedAt: sql`now()` })
      .where(
        and(
          eq(agentChats.userId, userId),
          eq(agentChats.id, chatId),
          or(isNull(agentChats.turnStartedAt), lt(agentChats.turnStartedAt, sql`now() - interval '10 minutes'`)),
        ),
      )
      .returning({ previous: sql<Date | null>`old.turn_started_at` });
    if (!row) {
      const [owned] = await tx
        .select({ id: agentChats.id })
        .from(agentChats)
        .where(and(eq(agentChats.userId, userId), eq(agentChats.id, chatId)));
      return owned ? "busy" : "missing";
    }
    if (row.previous !== null)
      await tx
        .update(agentTurns)
        .set({ outcome: "failed", errorCode: "interrupted" })
        .where(and(eq(agentTurns.chatId, chatId), eq(agentTurns.outcome, "running")));
    return "claimed";
  }
  async releaseTurn(chatId: string): Promise<void> {
    await this.db.update(agentChats).set({ turnStartedAt: null }).where(eq(agentChats.id, chatId));
  }
  async appendMessages(chatId: string, messages: NewAgentMessage[], reportedJobIds: string[] = []): Promise<void> {
    await this.db.transaction(async (tx) => {
      const chat = await tx
        .select({ id: agentChats.id })
        .from(agentChats)
        .where(eq(agentChats.id, chatId))
        .for("update");
      if (!chat.length) throw new Error("Chat no longer exists");
      const [last] = await tx
        .select({ seq: max(agentMessages.seq) })
        .from(agentMessages)
        .where(eq(agentMessages.chatId, chatId));
      const seq = last?.seq ?? 0;
      if (messages.length)
        await tx.insert(agentMessages).values(messages.map((message, i) => ({ ...message, chatId, seq: seq + i + 1 })));
      if (reportedJobIds.length)
        await tx
          .update(agentChatJobs)
          .set({ reported: true })
          .where(and(eq(agentChatJobs.chatId, chatId), inArray(agentChatJobs.jobId, reportedJobIds)));
      await tx
        .update(agentChats)
        .set({ updatedAt: sql`now()` })
        .where(eq(agentChats.id, chatId));
    });
  }
  async listMessages(chatId: string): Promise<AgentMessage[]> {
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.chatId, chatId))
      .orderBy(asc(agentMessages.seq));
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      kind: row.kind,
      content: row.content,
      data: row.data,
      createdAt: row.createdAt.toISOString(),
    }));
  }
  async linkJob(chatId: string, jobId: string, dataset: string, parameters: Record<string, unknown>): Promise<void> {
    await this.db.insert(agentChatJobs).values({ chatId, jobId, dataset, parameters }).onConflictDoNothing();
  }
  async listChatJobs(chatId: string): Promise<{ jobId: string; dataset: string; reported: boolean }[]> {
    return this.db
      .select({ jobId: agentChatJobs.jobId, dataset: agentChatJobs.dataset, reported: agentChatJobs.reported })
      .from(agentChatJobs)
      .where(eq(agentChatJobs.chatId, chatId));
  }
  async listUnreportedJobIds(chatId: string): Promise<string[]> {
    const rows = await this.db
      .select({ jobId: agentChatJobs.jobId })
      .from(agentChatJobs)
      .where(and(eq(agentChatJobs.chatId, chatId), eq(agentChatJobs.reported, false)));
    return rows.map((row) => row.jobId);
  }
  async findChatsWaiting(): Promise<{ id: string; userId: string }[]> {
    return this.db
      .selectDistinct({ id: agentChats.id, userId: agentChats.userId })
      .from(agentChats)
      .innerJoin(agentChatJobs, eq(agentChats.id, agentChatJobs.chatId))
      .where(eq(agentChatJobs.reported, false));
  }
  async findReusableJob(userId: string, dataset: string, parameters: Record<string, unknown>): Promise<string | null> {
    const [row] = await this.db
      .select({ jobId: agentChatJobs.jobId })
      .from(agentChatJobs)
      .innerJoin(agentChats, eq(agentChatJobs.chatId, agentChats.id))
      .where(
        and(
          eq(agentChats.userId, userId),
          eq(agentChatJobs.dataset, dataset),
          sql`${agentChatJobs.parameters} = ${JSON.stringify(parameters)}::jsonb`,
          sql`${agentChatJobs.createdAt} > now() - interval '24 hours'`,
        ),
      )
      .orderBy(desc(agentChatJobs.createdAt))
      .limit(1);
    return row?.jobId ?? null;
  }
  async insertTurn(record: TurnRecord): Promise<string> {
    const [row] = await this.db.insert(agentTurns).values(record).returning({ id: agentTurns.id });
    if (!row) throw new Error("Turn insert returned no row");
    return row.id;
  }
  async reserveMessageTurn(
    userId: string,
    chatId: string,
    limit: number,
    metadata: { provider: string; model: string; promptVersion: string },
  ): Promise<Admission> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
      const count = await tx.$count(
        agentTurns,
        and(
          eq(agentTurns.userId, userId),
          eq(agentTurns.trigger, "message"),
          sql`${agentTurns.createdAt} > now() - interval '24 hours'`,
          sql`not (${agentTurns.outcome} = 'failed' and ${agentTurns.modelCalls} = 0)`,
        ),
      );
      if (count >= limit) return { status: "limited" };
      const claim = await this.claim(tx, userId, chatId);
      if (claim !== "claimed") return { status: claim };
      const [row] = await tx
        .insert(agentTurns)
        .values({
          chatId,
          userId,
          trigger: "message",
          outcome: "running",
          ...metadata,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: "0",
          modelCalls: 0,
          jobIds: [],
          durationMs: 0,
        })
        .returning({ id: agentTurns.id });
      if (!row) throw new Error("Turn reservation returned no row");
      return { status: "admitted", turnId: row.id };
    });
  }
  async updateTurn(id: string, record: TurnRecord): Promise<void> {
    const { chatId: _chatId, userId, trigger: _trigger, ...changes } = record;
    await this.db
      .update(agentTurns)
      .set(changes)
      .where(and(eq(agentTurns.id, id), eq(agentTurns.userId, userId)));
  }
  async countModelCall(id: string, userId: string): Promise<void> {
    await this.db
      .update(agentTurns)
      .set({ modelCalls: sql`${agentTurns.modelCalls} + 1` })
      .where(and(eq(agentTurns.id, id), eq(agentTurns.userId, userId)));
  }
  async failTurn(id: string, userId: string, errorCode: string): Promise<void> {
    await this.db
      .update(agentTurns)
      .set({ outcome: "failed", errorCode })
      .where(and(eq(agentTurns.id, id), eq(agentTurns.userId, userId)));
  }
  async countMessageTurnsSince(userId: string, hours: number): Promise<number> {
    return this.db.$count(
      agentTurns,
      and(
        eq(agentTurns.userId, userId),
        eq(agentTurns.trigger, "message"),
        sql`${agentTurns.createdAt} > now() - ${hours} * interval '1 hour'`,
        sql`not (${agentTurns.outcome} = 'failed' and ${agentTurns.modelCalls} = 0)`,
      ),
    );
  }
}
function toChat(row: typeof agentChats.$inferSelect): Chat {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
