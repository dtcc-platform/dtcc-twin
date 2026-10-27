import { describe, expect, it } from "vitest";
import { createJobBodySchema, jobSchema } from "./jobs.js";

const job = {
  id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
  userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
  dataset: "smoke",
  parameters: { bounds: [319891, 6399790, 320091, 6399990] },
  state: "running",
  progress: { percent: 50, message: "halfway", phase: null },
  error: null,
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:05.000Z",
  completedAt: null,
};

describe("jobSchema", () => {
  it("strips properties the API does not declare, such as the engine's job id", () => {
    expect(jobSchema.parse({ ...job, engineJobId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8d" })).toEqual(job);
  });
});

describe("createJobBodySchema", () => {
  const body = { dataset: "smoke", parameters: { bounds: [319891, 6399790, 320091, 6399990] } };

  it("accepts a Dataset name and its parameters", () => {
    expect(createJobBodySchema.parse(body)).toEqual(body);
  });

  it("needs both fields and nothing else", () => {
    expect(createJobBodySchema.safeParse({ dataset: "smoke" }).success).toBe(false);
    expect(createJobBodySchema.safeParse({ parameters: {} }).success).toBe(false);
    expect(createJobBodySchema.safeParse({ ...body, target: "local" }).success).toBe(false);
  });

  it("rejects a Dataset name that isn't one", () => {
    expect(createJobBodySchema.safeParse({ ...body, dataset: "../smoke" }).success).toBe(false);
  });

  // The engine always delivers a canonical .dtccpkg package.
  it("rejects a format parameter, naming it", () => {
    const result = createJobBodySchema.safeParse({ ...body, parameters: { ...body.parameters, format: "geojson" } });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["parameters", "format"]]);
  });
});
