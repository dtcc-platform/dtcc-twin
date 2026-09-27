import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateJobBody, Job, JobPage, JobResult, OffsetPaginationQuery } from "@repo/contracts";
import { EngineClient } from "../engine/engine.client.js";
import type { EngineManifest } from "../engine/engine.schemas.js";
import { artifactPath, toJobProgress, toJobResult } from "./job-result.js";
import { JobsRepository, type StoredJob } from "./jobs.repository.js";
import { readPackageEntry, readPackageManifest } from "./package-archive.js";
import { PackageStorage } from "./package-storage.js";

type CompletedJob = StoredJob & { manifest: EngineManifest };

export type JobFile = { content: Uint8Array; mediaType: string; fileName: string };

@Injectable()
export class JobsService {
  constructor(
    private readonly repository: JobsRepository,
    private readonly engine: EngineClient,
    private readonly storage: PackageStorage,
  ) {}

  async create({ dataset, parameters }: CreateJobBody): Promise<Job> {
    const datasets = await this.engine.listDatasets();
    const descriptor = datasets.find((candidate) => candidate.name === dataset);
    if (!descriptor) throw new NotFoundException(`Dataset ${dataset} not found`);
    if (!descriptor.available) throw new ConflictException(`Dataset ${dataset} can't run right now`);

    const engineJobId = await this.engine.submitJob(dataset, parameters);
    return this.repository.insert({ dataset, parameters, engineJobId, state: "queued" });
  }

  async list({ limit, offset }: OffsetPaginationQuery): Promise<JobPage> {
    const page = await this.repository.findPage(limit, offset);
    const items = await Promise.all(page.jobs.map((job) => this.refresh(job)));
    return { items, limit, offset, total: page.total };
  }

  get(id: string): Promise<Job> {
    return this.findFresh(id);
  }

  async result(id: string): Promise<JobResult> {
    const job = await this.findCompleted(id);
    return toJobResult(job.manifest);
  }

  async artifact(id: string, file: string): Promise<JobFile> {
    const job = await this.findCompleted(id);
    const artifact = job.manifest.artifacts.find((candidate) => candidate.path === artifactPath(file));
    if (!artifact) throw new NotFoundException(`Job ${id} has no artifact ${file}`);

    const archive = await this.storage.read(job.id);
    const content = readPackageEntry(archive, artifact.path);
    if (!content) throw new Error(`The package of job ${id} lacks ${artifact.path}, which its manifest lists`);
    return { content, mediaType: artifact.media_type, fileName: file };
  }

  async package(id: string): Promise<JobFile> {
    const job = await this.findCompleted(id);
    const content = await this.storage.read(job.id);
    return { content, mediaType: "application/zip", fileName: `${job.dataset}.dtccpkg` };
  }

  private async findFresh(id: string): Promise<StoredJob> {
    const job = await this.repository.findById(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return this.refresh(job);
  }

  private async findCompleted(id: string): Promise<CompletedJob> {
    const job = await this.findFresh(id);
    if (job.state !== "completed" || !job.manifest) throw new ConflictException(`Job ${id} has not completed`);
    return { ...job, manifest: job.manifest };
  }

  // The engine only answers when asked, so a job is brought up to date whenever it is read.
  private async refresh(job: StoredJob): Promise<StoredJob> {
    if (job.state === "completed" || job.state === "failed") return job;

    const status = await this.engine.getJob(job.engineJobId);
    switch (status.state) {
      case "queued":
        return this.repository.update(job.id, { state: "queued", progress: null, error: null });
      case "running":
        return this.repository.update(job.id, {
          state: "running",
          progress: toJobProgress(status.progress),
          error: null,
        });
      case "failed":
        return this.repository.update(job.id, { state: "failed", progress: null, error: status.error });
      case "unknown":
        return this.repository.update(job.id, {
          state: "failed",
          progress: null,
          error: "The engine no longer has this job; submit it again.",
        });
      case "completed":
        return this.complete(job);
    }
  }

  private async complete(job: StoredJob): Promise<StoredJob> {
    const archive = await this.engine.downloadPackage(job.engineJobId);
    await this.storage.save(job.id, archive);
    const manifest = readPackageManifest(archive);
    return this.repository.update(job.id, {
      state: "completed",
      progress: null,
      error: null,
      manifest,
      completed: true,
    });
  }
}
