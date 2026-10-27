import type { JobProgress } from "@repo/contracts";
import { sql } from "drizzle-orm";
import { index, jsonb, snakeCase, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { users } from "../users/users.table.js";

export const jobs = snakeCase.table(
  "jobs",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dataset: varchar({ length: 100 }).notNull(),
    parameters: jsonb().$type<Record<string, unknown>>().notNull(),
    // DTCC Engine's id for the job: the only way to ask the engine about it, which lists no jobs.
    engineJobId: uuid().notNull().unique(),
    state: text({ enum: ["queued", "running", "completed", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    progress: jsonb().$type<JobProgress>(),
    error: text(),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("jobs_user_id_index").on(table.userId)],
);
