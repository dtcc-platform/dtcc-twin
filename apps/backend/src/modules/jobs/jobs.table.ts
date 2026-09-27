import type { JobProgress, JobState } from "@repo/contracts";
import { sql } from "drizzle-orm";
import { index, jsonb, snakeCase, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import type { EngineManifest } from "../engine/engine.schemas.js";

// Not user-owned yet: the demo lists every job to everyone.
export const jobs = snakeCase.table(
  "jobs",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    dataset: varchar({ length: 100 }).notNull(),
    parameters: jsonb().$type<Record<string, unknown>>().notNull(),
    engineJobId: text().notNull(),
    state: varchar({ length: 20 }).$type<JobState>().notNull(),
    progress: jsonb().$type<JobProgress>(),
    error: text(),
    /** The package's manifest, stored when the job completes. */
    manifest: jsonb().$type<EngineManifest>(),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("jobs_created_at_index").on(table.createdAt)],
);
