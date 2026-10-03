import { isDeepStrictEqual } from "node:util";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateJobBody, Job, JobPage, OffsetPaginationQuery } from "@repo/contracts";
import { EngineClient, type EngineJob } from "../../infra/engine/engine.client.js";
import { EngineUnavailableError } from "../../infra/engine/engine.errors.js";
import { JobsRepository, type JobChanges, type StoredJob } from "./jobs.repository.js";

@Injectable()
export class JobsService {
  constructor(
    private readonly repository: JobsRepository,
    private readonly engine: EngineClient,
  ) {}

  async create(userId: string, body: CreateJobBody): Promise<Job> {
    const engineJobId = await this.engine.submitJob(body.dataset, body.parameters);
    return this.repository.insert(userId, { ...body, engineJobId });
  }

  async list(userId: string, { limit, offset }: OffsetPaginationQuery): Promise<JobPage> {
    const { jobs, total } = await this.repository.findPage(userId, limit, offset);
    const items = await Promise.all(jobs.map((job) => this.refresh(job)));
    return { items, limit, offset, total };
  }

  async get(userId: string, id: string): Promise<Job> {
    const job = await this.repository.findById(userId, id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return this.refresh(job);
  }

  /** check the job status, will probably change to cron later */
  private async refresh(job: StoredJob): Promise<StoredJob> {
    if (job.state === "completed" || job.state === "failed") return job;

    let engineJob: EngineJob | null;
    try {
      engineJob = await this.engine.getJob(job.engineJobId);
    } catch (error) {
      // keep last known state
      if (error instanceof EngineUnavailableError) return job;
      throw error;
    }

    const changes = changesFrom(engineJob);
    if (!changes || isUnchanged(job, changes)) return job;
    return (await this.repository.update(job.userId, job.id, changes)) ?? job;
  }
}

function changesFrom(engineJob: EngineJob | null): JobChanges | null {
  if (!engineJob) return { state: "failed", progress: null, error: "The engine no longer has this job" };

  switch (engineJob.state) {
    case "queued":
    case "running":
      return { state: engineJob.state, progress: engineJob.progress, error: null };
    case "failed":
      return {
        state: "failed",
        progress: null,
        error: engineJob.errorType ? `The job failed (${engineJob.errorType})` : "The job failed",
      };
    case "completed":
      // todo: complete the job after storing the package
      return null;
  }
}

function isUnchanged(job: StoredJob, changes: JobChanges): boolean {
  return (
    job.state === changes.state && job.error === changes.error && isDeepStrictEqual(job.progress, changes.progress)
  );
}
