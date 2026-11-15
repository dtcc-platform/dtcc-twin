import type { Job, JobState } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { pendingDownloadStep } from "./pending-download-step.ts";

function job(state: JobState, artifactFormat: string | null = "tif"): Job {
  return {
    id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
    userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
    dataset: "orthophoto",
    parameters: {},
    artifactFormat,
    state,
    progress: null,
    error: null,
    createdAt: "2026-11-14T10:00:00.000Z",
    updatedAt: "2026-11-14T10:00:00.000Z",
    completedAt: null,
  };
}

describe("pendingDownloadStep", () => {
  it("waits while the job is loading, queued or running", () => {
    expect(pendingDownloadStep(undefined)).toBe("wait");
    expect(pendingDownloadStep(job("queued"))).toBe("wait");
    expect(pendingDownloadStep(job("running"))).toBe("wait");
  });

  // The file the user asked for when they chose a format; the whole package when there was none to choose.
  it("downloads a completed job's artifact, or its package when it has no format", () => {
    expect(pendingDownloadStep(job("completed"))).toBe("artifact");
    expect(pendingDownloadStep(job("completed", null))).toBe("package");
  });

  it("gives up on a job that failed or was cancelled", () => {
    expect(pendingDownloadStep(job("failed"))).toBe("give-up");
    expect(pendingDownloadStep(job("cancelled"))).toBe("give-up");
  });
});
