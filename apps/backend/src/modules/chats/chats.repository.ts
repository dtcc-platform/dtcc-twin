import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { ChatSummary } from "@repo/contracts";
import { and, asc, desc, eq, isNull, lt, max, or, sql } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import type { ChatMessage, NewChatMessage } from "./chat-messages.js";
import { chatMessages } from "./chat-messages.table.js";
import { chatTurns } from "./chat-turns.table.js";
import { chats } from "./chats.table.js";

/** A chat as stored: the contract's summary, its owner, and whether a turn holds it. */
export type StoredChat = ChatSummary & { userId: string; answering: boolean };

export type ChatTurnRecord = Pick<
  typeof chatTurns.$inferInsert,
  | "userId"
  | "chatId"
  | "trigger"
  | "outcome"
  | "steps"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "error"
>;

export type TurnClaim = "claimed" | "busy" | "missing";

// A turn holds its chat for minutes at most, so an older claim belongs to a process that died mid-turn.
const claimLifetime = sql`interval '10 minutes'`;

const chatColumns = {
  id: chats.id,
  userId: chats.userId,
  title: chats.title,
  createdAt: chats.createdAt,
  updatedAt: chats.updatedAt,
  answering: sql<boolean>`coalesce(${chats.turnStartedAt} > now() - ${claimLifetime}, false)`,
};

// Every query on chats names the owner, so another user's chat matches no row.
@Injectable()
export class ChatsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findPage(userId: string, limit: number, offset: number): Promise<{ chats: StoredChat[]; total: number }> {
    const owned = eq(chats.userId, userId);
    const [rows, total] = await Promise.all([
      this.db
        .select(chatColumns)
        .from(chats)
        .where(owned)
        .orderBy(desc(chats.updatedAt), desc(chats.id))
        .limit(limit)
        .offset(offset),
      this.db.$count(chats, owned),
    ]);
    return { chats: rows.map(toStoredChat), total };
  }

  async findById(userId: string, id: string): Promise<StoredChat | undefined> {
    const [row] = await this.db
      .select(chatColumns)
      .from(chats)
      .where(and(eq(chats.userId, userId), eq(chats.id, id)));
    return row && toStoredChat(row);
  }

  /** Creates a chat already claimed, for the turn that answers its first message. */
  async insertClaimed(userId: string, title: string): Promise<StoredChat> {
    const [row] = await this.db
      .insert(chats)
      .values({ userId, title, turnStartedAt: sql`now()` })
      .returning();
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return toStoredChat({ ...row, answering: true });
  }

  /** Claims the chat for one turn. Another claim is `busy` until the turn is released or its claim goes stale. */
  async claimTurn(userId: string, id: string): Promise<TurnClaim> {
    const owned = and(eq(chats.userId, userId), eq(chats.id, id));
    const [claimed] = await this.db
      .update(chats)
      .set({ turnStartedAt: sql`now()` })
      .where(and(owned, or(isNull(chats.turnStartedAt), lt(chats.turnStartedAt, sql`now() - ${claimLifetime}`))))
      .returning({ id: chats.id });
    if (claimed) return "claimed";
    return (await this.db.$count(chats, owned)) > 0 ? "busy" : "missing";
  }

  async releaseTurn(id: string): Promise<void> {
    await this.db.update(chats).set({ turnStartedAt: null }).where(eq(chats.id, id));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(chats)
      .where(and(eq(chats.userId, userId), eq(chats.id, id)))
      .returning({ id: chats.id });
    return deleted.length > 0;
  }

  // Only for a chat the caller has already found by its owner.
  async listMessages(chatId: string): Promise<ChatMessage[]> {
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(asc(chatMessages.seq));
    return rows.map(toChatMessage);
  }

  /** Appends messages in order. Only the turn holding the chat appends, so positions never collide. */
  async appendMessages(chatId: string, messages: NewChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ seq: max(chatMessages.seq) })
        .from(chatMessages)
        .where(eq(chatMessages.chatId, chatId));
      const first = (last?.seq ?? 0) + 1;
      await tx
        .insert(chatMessages)
        .values(messages.map((message, index) => ({ chatId, seq: first + index, ...message })));
    });
  }

  async insertTurn(record: ChatTurnRecord): Promise<void> {
    await this.db.insert(chatTurns).values({ ...record, finishedAt: sql`now()` });
  }
}

function toStoredChat(row: Omit<typeof chats.$inferSelect, "turnStartedAt"> & { answering: boolean }): StoredChat {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    answering: row.answering,
  };
}

function toChatMessage(row: typeof chatMessages.$inferSelect): ChatMessage {
  // The kind decides which of content and data are set; the code that stored the row followed it.
  return {
    id: row.id,
    seq: row.seq,
    createdAt: row.createdAt.toISOString(),
    kind: row.kind,
    content: row.content,
    data: row.data,
  } as ChatMessage;
}
