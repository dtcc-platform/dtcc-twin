import { isDeepStrictEqual } from "node:util";
import type { ReadStream } from "node:fs";
import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { CreateJobBody, Job, JobPage, OffsetPaginationQuery } from "@repo/contracts";
import { EngineClient, type EngineJob } from "../../infra/engine/engine.client.js";
import { EngineUnavailableError } from "../../infra/engine/engine.errors.js";
import { PackageStorage } from "../../infra/storage/package-storage.js";
import { JobsRepository, type JobChanges, type StoredJob } from "./jobs.repository.js";

export type JobPackage = { content: ReadStream; fileName: string };

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly repository: JobsRepository,
    private readonly engine: EngineClient,
    private readonly storage: PackageStorage,
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

  /** The completed job's package, from storage: the engine deletes its own copy after 30 days. */
  async package(userId: string, id: string): Promise<JobPackage> {
    const job = await this.get(userId, id);
    if (job.state !== "completed") throw new ConflictException(`Job ${id} has not completed`);

    const content = await this.storage.open(job.id);
    if (!content) throw new Error(`The package of completed job ${id} is missing from storage`);
    return { content, fileName: `${job.dataset}-${job.id}.dtccpkg` };
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

    if (engineJob?.state === "completed" && engineJob.packageAvailable) return this.complete(job);

    const changes = changesFrom(engineJob);
    if (isUnchanged(job, changes)) return job;
    return (await this.repository.update(job.userId, job.id, changes)) ?? job;
  }

  /** Stores the job's package, then marks it completed, so a completed job's package can always be downloaded. */
  private async complete(job: StoredJob): Promise<StoredJob> {
    try {
      await this.storage.save(job.id, await this.engine.downloadPackage(job.engineJobId));
    } catch (error) {
      this.logger.warn(`Storing the package of job ${job.id} failed: ${String(error)}`);
      return job;
    }
    const completed = await this.repository.complete(job.userId, job.id);
    return completed ?? job;
  }
}

function changesFrom(engineJob: EngineJob | null): JobChanges {
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
      // Only without a package: with one, the job is completed by storing it.
      return { state: "failed", progress: null, error: "The engine has no package for this job" };
  }
}

function isUnchanged(job: StoredJob, changes: JobChanges): boolean {
  return (
    job.state === changes.state && job.error === changes.error && isDeepStrictEqual(job.progress, changes.progress)
  );
}
