import { sql } from "drizzle-orm";
import { index, snakeCase, timestamp, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { jobs } from "../jobs/jobs.table.js";
import { chats } from "./chats.table.js";

// A job the assistant started in a chat. The job is the user's: deleting the chat leaves it in their Downloads.
export const chatJobs = snakeCase.table(
  "chat_jobs",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    chatId: uuid()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    jobId: uuid()
      .notNull()
      .unique()
      .references(() => jobs.id, { onDelete: "cascade" }),
    // When the model was told how the job ended; until then the chat waits for it.
    reportedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("chat_jobs_chat_id_index").on(table.chatId),
    // The watcher reads every chat still waiting for a job.
    index("chat_jobs_waiting_index")
      .on(table.chatId)
      .where(sql`${table.reportedAt} is null`),
  ],
);
