import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Job } from "@repo/contracts";
import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import type { EngineManifest } from "../engine/engine.schemas.js";
import { jobs } from "./jobs.table.js";

/** A job with what the backend keeps about it beyond the contract. */
export type StoredJob = Job & {
  engineJobId: string;
  manifest: EngineManifest | null;
};

export type NewJob = Pick<StoredJob, "dataset" | "parameters" | "engineJobId" | "state">;

export type JobChanges = Pick<StoredJob, "state" | "progress" | "error"> & {
  manifest?: EngineManifest;
  completed?: true;
};

@Injectable()
export class JobsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findPage(limit: number, offset: number): Promise<{ jobs: StoredJob[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db.select().from(jobs).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(limit).offset(offset),
      this.db.$count(jobs),
    ]);
    return { jobs: rows.map(toStoredJob), total };
  }

  async findById(id: string): Promise<StoredJob | undefined> {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, id));
    return row && toStoredJob(row);
  }

  async insert(values: NewJob): Promise<StoredJob> {
    const [row] = await this.db.insert(jobs).values(values).returning();
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return toStoredJob(row);
  }

  async update(id: string, { completed, ...changes }: JobChanges): Promise<StoredJob> {
    const values = completed ? { ...changes, completedAt: sql`now()` } : changes;
    const [row] = await this.db.update(jobs).set(values).where(eq(jobs.id, id)).returning();
    if (!row) throw new Error(`Job ${id} disappeared during an update`);
    return toStoredJob(row);
  }
}

function toStoredJob(row: typeof jobs.$inferSelect): StoredJob {
  return {
    id: row.id,
    dataset: row.dataset,
    parameters: row.parameters,
    state: row.state,
    progress: row.progress,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    engineJobId: row.engineJobId,
    manifest: row.manifest,
  };
}
