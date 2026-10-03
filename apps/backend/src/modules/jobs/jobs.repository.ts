import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { CreateJobBody, Job } from "@repo/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import { jobs } from "./jobs.table.js";

export type StoredJob = Job & { engineJobId: string };

export type JobChanges = Pick<Job, "state" | "progress" | "error">;

@Injectable()
export class JobsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findPage(userId: string, limit: number, offset: number): Promise<{ jobs: StoredJob[]; total: number }> {
    const owned = eq(jobs.userId, userId);
    const [rows, total] = await Promise.all([
      this.db.select().from(jobs).where(owned).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(limit).offset(offset),
      this.db.$count(jobs, owned),
    ]);
    return { jobs: rows.map(toStoredJob), total };
  }

  async findById(userId: string, id: string): Promise<StoredJob | undefined> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.id, id)));
    return row && toStoredJob(row);
  }

  async insert(userId: string, values: CreateJobBody & { engineJobId: string }): Promise<StoredJob> {
    const [row] = await this.db
      .insert(jobs)
      .values({ ...values, userId })
      .returning();
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return toStoredJob(row);
  }

  async update(userId: string, id: string, changes: JobChanges): Promise<StoredJob | undefined> {
    const [row] = await this.db
      .update(jobs)
      .set(changes)
      .where(and(eq(jobs.userId, userId), eq(jobs.id, id)))
      .returning();
    return row && toStoredJob(row);
  }
}

function toStoredJob(row: typeof jobs.$inferSelect): StoredJob {
  return {
    id: row.id,
    userId: row.userId,
    dataset: row.dataset,
    parameters: row.parameters,
    engineJobId: row.engineJobId,
    state: row.state,
    progress: row.progress,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
