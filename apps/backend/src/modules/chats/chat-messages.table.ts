import type Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { integer, jsonb, snakeCase, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { chatMessageKinds, type NewChatMessage } from "./chat-messages.js";
import { chats } from "./chats.table.js";

export const chatMessages = snakeCase.table(
  "chat_messages",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    chatId: uuid()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    // Position in the conversation, the order the model reads it in.
    seq: integer().notNull(),
    kind: text({ enum: chatMessageKinds }).notNull(),
    content: jsonb().$type<Anthropic.ContentBlockParam[]>(),
    data: jsonb().$type<NewChatMessage["data"]>(),
    ...timestamps,
  },
  (table) => [uniqueIndex("chat_messages_chat_id_seq_index").on(table.chatId, table.seq)],
);
