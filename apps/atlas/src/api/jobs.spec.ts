import type { Job, JobPage, JobState } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { jobsRefetchInterval } from "./jobs.ts";

function page(...states: JobState[]): JobPage {
  const items = states.map((state, index): Job => ({
    id: `0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a${String(index).padStart(2, "0")}`,
    dataset: "building_footprints",
    parameters: {},
    state,
    progress: null,
    error: null,
    createdAt: "2026-09-28T10:00:00.000Z",
    updatedAt: "2026-09-28T10:00:00.000Z",
    completedAt: null,
  }));
  return { items, limit: 20, offset: 0, total: items.length };
}

describe("jobsRefetchInterval", () => {
  it("polls every second while any job is queued or running", () => {
    expect(jobsRefetchInterval(page("completed", "queued"))).toBe(1000);
    expect(jobsRefetchInterval(page("running", "failed"))).toBe(1000);
  });

  it("stops once every job has finished, or before anything has loaded", () => {
    expect(jobsRefetchInterval(page("completed", "failed"))).toBe(false);
    expect(jobsRefetchInterval(page())).toBe(false);
    expect(jobsRefetchInterval(undefined)).toBe(false);
  });
});
