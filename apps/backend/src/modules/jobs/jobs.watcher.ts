import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { every, type Repeating } from "../../common/background/every.js";
import type { Env } from "../../config/env.schema.js";
import { JobsService } from "./jobs.service.js";

/** Refreshes unfinished jobs from the engine every JOBS_REFRESH_INTERVAL_SECONDS, since the engine never notifies. */
@Injectable()
export class JobsWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsWatcher.name);
  private readonly intervalMs: number;
  private repeating: Repeating | undefined;

  constructor(
    private readonly jobs: JobsService,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs = config.get("JOBS_REFRESH_INTERVAL_SECONDS", { infer: true }) * 1000;
  }

  onApplicationBootstrap(): void {
    if (this.intervalMs > 0) this.repeating = every(this.intervalMs, () => this.jobs.refreshActive(), this.logger);
  }

  // Before shutdown, when the database pool closes: a run in progress still needs it.
  async onModuleDestroy(): Promise<void> {
    await this.repeating?.stop();
  }
}
