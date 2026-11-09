import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  snakeCase,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { jobs } from "../jobs/jobs.table.js";
import { users } from "../users/users.table.js";

export const agentChats = snakeCase.table(
  "agent_chats",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull(),
    turnStartedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("agent_chats_user_id_index").on(t.userId)],
);

export const agentMessages = snakeCase.table(
  "agent_messages",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    chatId: uuid()
      .notNull()
      .references(() => agentChats.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    kind: text({ enum: ["user", "assistant", "tool_results", "job_update", "notice"] }).notNull(),
    content: jsonb(),
    data: jsonb(),
    ...timestamps,
  },
  (t) => [uniqueIndex("agent_messages_chat_seq_unique").on(t.chatId, t.seq)],
);

export const agentChatJobs = snakeCase.table(
  "agent_chat_jobs",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    chatId: uuid()
      .notNull()
      .references(() => agentChats.id, { onDelete: "cascade" }),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    dataset: text().notNull(),
    parameters: jsonb().$type<Record<string, unknown>>().notNull(),
    reported: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("agent_chat_jobs_chat_job_unique").on(t.chatId, t.jobId),
    index("agent_chat_jobs_job_index").on(t.jobId),
    index("agent_chat_jobs_unreported_index")
      .on(t.chatId)
      .where(sql`not ${t.reported}`),
  ],
);

export const agentTurns = snakeCase.table(
  "agent_turns",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    chatId: uuid().references(() => agentChats.id, { onDelete: "set null" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trigger: text({ enum: ["message", "job_update"] }).notNull(),
    outcome: text({ enum: ["running", "answered", "refused", "failed", "timed_out", "stopped"] })
      .notNull()
      .default("running"),
    provider: text().notNull(),
    model: text().notNull(),
    promptVersion: text().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadTokens: integer().notNull(),
    cacheWriteTokens: integer().notNull(),
    costUsd: numeric(),
    modelCalls: integer().notNull(),
    jobIds: uuid().array().notNull(),
    durationMs: integer().notNull(),
    errorCode: text(),
    ...timestamps,
  },
  (t) => [
    index("agent_turns_chat_id_index").on(t.chatId),
    index("agent_turns_user_created_index").on(t.userId, t.createdAt),
  ],
);
