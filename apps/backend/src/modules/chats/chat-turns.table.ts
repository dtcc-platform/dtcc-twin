import { sql } from "drizzle-orm";
import { index, integer, snakeCase, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { users } from "../users/users.table.js";
import { chats } from "./chats.table.js";

// One row per turn of the model: what it cost and how it ended.
export const chatTurns = snakeCase.table(
  "chat_turns",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Kept when the chat is deleted, so its turns still count against the user.
    chatId: uuid().references(() => chats.id, { onDelete: "set null" }),
    // What started the turn: the user's message, or jobs ending after the turn that started them.
    trigger: text({ enum: ["message", "job_update"] }).notNull(),
    outcome: text({ enum: ["answered", "refused", "failed", "stopped"] }).notNull(),
    steps: integer().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadTokens: integer().notNull(),
    cacheWriteTokens: integer().notNull(),
    error: text(),
    finishedAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("chat_turns_user_id_index").on(table.userId, table.createdAt),
    index("chat_turns_chat_id_index").on(table.chatId),
  ],
);
