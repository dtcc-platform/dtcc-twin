import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { EngineClient } from "./engine.client.js";
import {
  engineDescriptorSchema,
  engineProgressSchema,
  type EngineDataset,
  type EngineJobStatus,
  type EngineProgress,
} from "./engine.schemas.js";

// Relative to the working directory, which pnpm sets to apps/backend. Recorded by `pnpm fixtures:engine`.
const fixturesDir = resolve("fixtures/engine");
const packageExtension = ".dtccpkg";
const queuedMs = 2_000;
const runningMs = 8_000;

type FakeJob = { dataset: string; submittedAt: number };

/**
 * Stands in for DTCC Engine with real Core output recorded for one demo area. A job's state follows from the
 * time since it was submitted; while it runs, the recorded progress events are played back evenly spread.
 */
@Injectable()
export class FakeEngineClient extends EngineClient implements OnModuleInit {
  private datasets: EngineDataset[] = [];
  private readonly progress = new Map<string, EngineProgress[]>();
  private readonly jobs = new Map<string, FakeJob>();

  async onModuleInit(): Promise<void> {
    const descriptors = z.array(engineDescriptorSchema).parse(await readJson("descriptors.json"));

    const files = await readdir(fixturesDir);
    const recorded = files
      .filter((file) => file.endsWith(packageExtension))
      .map((file) => basename(file, packageExtension));

    for (const dataset of recorded) {
      const events = z.array(engineProgressSchema).parse(await readJson(`${dataset}.progress.json`));
      this.progress.set(dataset, events);
    }

    this.datasets = descriptors.map((descriptor) => ({
      ...descriptor,
      available: this.progress.has(descriptor.name),
    }));
  }

  listDatasets(): Promise<EngineDataset[]> {
    return Promise.resolve(this.datasets);
  }

  submitJob(dataset: string): Promise<string> {
    if (!this.progress.has(dataset)) throw new Error(`The fake engine has no recording of ${dataset}`);
    const engineJobId = randomUUID();
    this.jobs.set(engineJobId, { dataset, submittedAt: Date.now() });
    return Promise.resolve(engineJobId);
  }

  getJob(engineJobId: string): Promise<EngineJobStatus> {
    const job = this.jobs.get(engineJobId);
    if (!job) return Promise.resolve({ state: "unknown" });

    const runningFor = Date.now() - job.submittedAt - queuedMs;
    if (runningFor < 0) return Promise.resolve({ state: "queued" });
    if (runningFor >= runningMs) return Promise.resolve({ state: "completed" });

    const events = this.progress.get(job.dataset) ?? [];
    const eventIndex = Math.floor((runningFor / runningMs) * events.length);
    return Promise.resolve({ state: "running", progress: events[eventIndex] ?? null });
  }

  async downloadPackage(engineJobId: string): Promise<Uint8Array> {
    const job = this.jobs.get(engineJobId);
    if (!job) throw new Error(`The fake engine has no job ${engineJobId}`);
    return readFile(resolve(fixturesDir, `${job.dataset}${packageExtension}`));
  }
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(fixturesDir, file), "utf8"));
}
