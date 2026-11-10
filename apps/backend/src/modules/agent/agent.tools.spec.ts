import { z } from "zod";
import { createReadStream } from "node:fs";
import { ConfigService } from "@nestjs/config";
import { HttpException, HttpStatus, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { Job, Dataset } from "@repo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env.schema.js";
import { EngineUnavailableError } from "../../infra/engine/engine.errors.js";
import type { JobsService } from "../jobs/jobs.service.js";
import type { DatasetsService } from "../datasets/datasets.service.js";
import type { AgentRepository } from "./agent.repository.js";
import { AgentTools, type ToolContext } from "./agent.tools.js";
const id = "019a5184-7bc0-7000-8000-000000000001";
const fixture = new URL("../../../test/fixtures/city-small.dtccpkg", import.meta.url);
const city: Dataset = {
  name: "city",
  title: "City",
  description: "Buildings",
  dataCategory: "derived",
  resultKind: "city",
  timeoutHint: null,
  argsSchema: {
    type: "object",
    properties: { bounds: { type: "array" }, format: { type: "string" }, source: { type: "string" } },
    required: ["bounds"],
  },
};
const job: Job = {
  id,
  userId: id,
  dataset: "city",
  parameters: {},
  state: "completed",
  progress: null,
  error: null,
  createdAt: "2026-11-07T12:00:00Z",
  updatedAt: "2026-11-07T12:00:00Z",
  completedAt: "2026-11-07T12:00:00Z",
};
const use = { type: "tool_use" as const, id: "tool_1", name: "run_city", input: {} };
describe("Agent tools", () => {
  const jobs = { create: vi.fn(), get: vi.fn(), package: vi.fn() };
  const datasets = { list: vi.fn() };
  const repository = { linkJob: vi.fn(), findReusableJob: vi.fn() };
  let tools: AgentTools;
  let ctx: ToolContext;
  beforeEach(() => {
    jobs.create.mockReset().mockResolvedValue(job);
    jobs.get.mockReset().mockResolvedValue(job);
    jobs.package
      .mockReset()
      .mockImplementation(() => ({ content: createReadStream(fixture), fileName: "city.dtccpkg" }));
    repository.findReusableJob.mockReset().mockResolvedValue(null);
    datasets.list.mockReset().mockResolvedValue({ items: [city, { ...city, name: "trees" }] });
    tools = new AgentTools(
      jobs as unknown as JobsService,
      datasets as unknown as DatasetsService,
      repository as unknown as AgentRepository,
      new ConfigService<Env, true>({ AGENT_DATASETS: "city", AGENT_JOB_WAIT_MS: 20000, AGENT_MAX_MODEL_MB: 512 }),
    );
    ctx = {
      userId: id,
      chatId: id,
      bounds: [319499, 6397999, 319686, 6398175],
      signal: new AbortController().signal,
      status: vi.fn(),
      jobStarted: vi.fn(),
    };
  });
  afterEach(() => vi.useRealTimers());
  it("offers only enabled datasets and removes coordinates and format", async () => {
    const definitions = await tools.definitions();
    expect(definitions.map((t) => t.name)).toEqual(["run_city", "get_job", "list_available_data"]);
    expect(definitions[0]?.input_schema.properties).not.toHaveProperty("bounds");
    expect(definitions[0]?.input_schema.properties).not.toHaveProperty("format");
  });
  it("keeps lookup tools when the engine is unavailable", async () => {
    datasets.list.mockRejectedValue(new EngineUnavailableError());
    expect((await tools.definitions()).map((t) => t.name)).toEqual(["get_job", "list_available_data"]);
  });
  it("returns the package count and submits exactly the stored bounds", async () => {
    const result = await tools.run(ctx, use);
    expect(JSON.parse(z.string().parse(result.block.content))).toMatchObject({ buildings: 21, state: "completed" });
    expect(jobs.create).toHaveBeenCalledExactlyOnceWith(id, { dataset: "city", parameters: { bounds: ctx.bounds } });
    expect(result.reportedJobId).toBe(id);
  });
  it("reuses a recent job", async () => {
    repository.findReusableJob.mockResolvedValue(id);
    expect((await tools.run(ctx, use)).reportedJobId).toBe(id);
    expect(jobs.create).not.toHaveBeenCalled();
  });
  it("returns running at the wait deadline with a later-result note", async () => {
    vi.useFakeTimers();
    jobs.get.mockResolvedValue({ ...job, state: "running" });
    const run = tools.run(ctx, use);
    await vi.advanceTimersByTimeAsync(20000);
    const result = await run;
    expect(JSON.parse(z.string().parse(result.block.content))).toMatchObject({ state: "running" });
    expect(z.object({ note: z.string() }).parse(JSON.parse(z.string().parse(result.block.content))).note).toContain(
      "will be posted",
    );
    expect(result.reportedJobId).toBeNull();
  });
  it("returns failed jobs and engine failures as errors", async () => {
    jobs.get.mockResolvedValue({ ...job, state: "failed", error: "Computation failed" });
    expect((await tools.run(ctx, use)).block.is_error).toBe(true);
    jobs.create.mockRejectedValue(new EngineUnavailableError());
    expect((await tools.run(ctx, use)).block.is_error).toBe(true);
  });
  it("asks for an area before submitting", async () => {
    const result = await tools.run({ ...ctx, bounds: null }, use);
    expect(result.block.is_error).toBe(true);
    expect(z.string().parse(result.block.content)).toMatch(/area/i);
    expect(jobs.create).not.toHaveBeenCalled();
  });
  it("stops waiting on abort", async () => {
    const controller = new AbortController();
    jobs.get.mockResolvedValue({ ...job, state: "running" });
    const run = tools.run({ ...ctx, signal: controller.signal }, use);
    controller.abort();
    await expect(run).rejects.toThrow();
  });
  it("rejects unknown tools and another owner's job", async () => {
    expect((await tools.run(ctx, { ...use, name: "unknown" })).block.is_error).toBe(true);
    jobs.get.mockRejectedValue(new NotFoundException());
    expect((await tools.run(ctx, { ...use, name: "get_job", input: { job_id: id } })).block.is_error).toBe(true);
  });
  it("reports an unreadable package without invented facts", async () => {
    jobs.package.mockRejectedValue(new Error("corrupt"));
    const report = await tools.report(id, job);
    expect(report.note).toBe("The job completed, but its result could not be read.");
    expect(report).not.toHaveProperty("buildings");
  });
  it("lists the whole catalogue with run availability", async () => {
    const result = await tools.run(ctx, { ...use, name: "list_available_data" });
    expect(JSON.parse(z.string().parse(result.block.content))).toEqual([
      { name: "city", title: "City", description: "Buildings", availability: "can run now" },
      { name: "trees", title: "City", description: "Buildings", availability: "not yet" },
    ]);
  });
  it("says when it uses an earlier result", async () => {
    repository.findReusableJob.mockResolvedValue(id);
    await tools.run(ctx, use);
    expect(ctx.status).toHaveBeenCalledWith("Using an earlier City result…");
  });
  it("passes on the hourly job limit and Valkey being down without starting a job", async () => {
    jobs.create.mockRejectedValue(
      new HttpException("You can run up to 10 jobs an hour. Try again in 12 minutes.", HttpStatus.TOO_MANY_REQUESTS),
    );
    expect((await tools.run(ctx, use)).block).toMatchObject({
      is_error: true,
      content: JSON.stringify("You can run up to 10 jobs an hour. Try again in 12 minutes."),
    });
    jobs.create.mockRejectedValue(new ServiceUnavailableException("Valkey unavailable"));
    expect((await tools.run(ctx, use)).block).toMatchObject({
      is_error: true,
      content: JSON.stringify("Jobs cannot be started right now. Try again in a few minutes."),
    });
  });
  it("gives the model a fixed sentence for a failure and logs the detail", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jobs.create.mockRejectedValue(new Error('Failed query: insert into "jobs" params: internal'));
    const result = await tools.run(ctx, use);
    expect(result.block).toMatchObject({ is_error: true, content: JSON.stringify("The tool could not complete.") });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed query"));
    jobs.create.mockRejectedValue(new EngineUnavailableError());
    expect((await tools.run(ctx, use)).block.content).toBe(
      JSON.stringify("Engine is unavailable right now, so the job could not be started or read."),
    );
    jobs.get.mockRejectedValue(new NotFoundException("Job 123 not found"));
    expect((await tools.run(ctx, { ...use, name: "get_job", input: { job_id: id } })).block.content).toBe(
      JSON.stringify("No such job was found."),
    );
    expect((await tools.run(ctx, { ...use, name: "get_job", input: { job_id: "not-an-id" } })).block.content).toBe(
      JSON.stringify("The tool input was not valid."),
    );
    warn.mockRestore();
  });
});
