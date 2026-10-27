import type { Job, JobState } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { isActiveJob, jobPollInterval } from "./jobs.ts";

function job(state: JobState): Job {
  return {
    id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
    userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
    dataset: "smoke",
    parameters: {},
    state,
    progress: null,
    error: null,
    createdAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
    completedAt: null,
  };
}

describe("isActiveJob", () => {
  it("is true while the job waits or runs", () => {
    expect(isActiveJob(job("queued"))).toBe(true);
    expect(isActiveJob(job("running"))).toBe(true);
  });

  it("is false once the job has finished, however it finished", () => {
    expect(isActiveJob(job("completed"))).toBe(false);
    expect(isActiveJob(job("failed"))).toBe(false);
    expect(isActiveJob(job("cancelled"))).toBe(false);
  });
});

describe("jobPollInterval", () => {
  it("polls while any job is active", () => {
    expect(jobPollInterval([job("completed"), job("running")])).toBe(3000);
    expect(jobPollInterval([job("queued")])).toBe(3000);
  });

  it("stops when every job has finished, or before there are any", () => {
    expect(jobPollInterval([job("completed"), job("failed"), job("cancelled")])).toBe(false);
    expect(jobPollInterval([])).toBe(false);
  });
});
