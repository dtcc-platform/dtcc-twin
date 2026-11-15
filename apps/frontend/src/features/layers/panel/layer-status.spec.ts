import type { Job, JobState } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { layerStatus } from "./layer-status.ts";

function job(state: JobState, changes: Partial<Job> = {}): Job {
  return {
    id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
    userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
    dataset: "roads",
    parameters: {},
    artifactFormat: "geojson",
    state,
    progress: null,
    error: null,
    createdAt: "2026-11-14T10:00:00.000Z",
    updatedAt: "2026-11-14T10:00:00.000Z",
    completedAt: null,
    ...changes,
  };
}

describe("layerStatus", () => {
  it("says a result is on the map once its job has completed with a file the map draws", () => {
    expect(layerStatus(job("completed"))).toBe("On the map");
  });

  it("says a result shows up later while its job is queued or running", () => {
    expect(layerStatus(job("queued"))).toBe("Shows on the map when the job is done");
    expect(layerStatus(job("running"))).toBe("Shows on the map when the job is done");
  });

  it("gives the job's error when it failed", () => {
    expect(layerStatus(job("failed", { error: "The job failed (ValueError)" }))).toBe("The job failed (ValueError)");
    expect(layerStatus(job("failed"))).toBe("The job failed");
  });

  it("says a cancelled job has nothing to show", () => {
    expect(layerStatus(job("cancelled"))).toBe("The job was cancelled");
  });

  it("says a completed job without a file the map draws has nothing to show", () => {
    expect(layerStatus(job("completed", { artifactFormat: "tif" }))).toBe("No file the map can draw");
    expect(layerStatus(job("completed", { artifactFormat: null }))).toBe("No file the map can draw");
  });

  it("waits for the job while it's loading", () => {
    expect(layerStatus(undefined)).toBe("Loading…");
  });
});
