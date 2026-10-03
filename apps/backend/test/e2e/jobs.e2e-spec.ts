import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger, type INestApplication } from "@nestjs/common";
import { errorResponseSchema, jobPageSchema, jobSchema, type Job } from "@repo/contracts";
import request, { type Agent, type Response } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startStubEngine } from "../helpers/stub-engine.js";

// ConfigModule reads the environment when app.module.ts is imported, so the stub must be listening before that.
const engine = await startStubEngine();
const packageDir = await mkdtemp(join(tmpdir(), "packages-"));
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", engine.token);
vi.stubEnv("PACKAGE_STORAGE_DIR", packageDir);
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { truncateAllTables } = await import("../helpers/database.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");

const bounds = [319891, 6399790, 320091, 6399990];
const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";

describe("Jobs (e2e)", () => {
  let app: INestApplication<App>;
  // Two logged-in users, so every route can show it never reaches the other one's jobs.
  let ada: Agent;
  let adaId: string;
  let grace: Agent;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await engine.close();
    await rm(packageDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await truncateAllTables();
    engine.reset();
    ({ agent: ada, userId: adaId } = await loggedIn("ada@example.com"));
    ({ agent: grace } = await loggedIn("grace@example.com"));
  });

  async function loggedIn(email: string): Promise<{ agent: Agent; userId: string }> {
    const user = await app.get(UsersService).create({ email, name: "Owner", password: "correct horse" });
    const agent = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
    return { agent, userId: user.id };
  }

  async function submit(agent: Agent, parameters: Record<string, unknown> = { bounds }): Promise<Job> {
    const response = await agent.post("/api/jobs").send({ dataset: "smoke", parameters }).expect(201);
    return jobSchema.parse(response.body);
  }

  async function read(agent: Agent, id: string): Promise<Job> {
    return jobSchema.parse((await agent.get(`/api/jobs/${id}`).expect(200)).body);
  }

  // The engine's id of the job submitted last, for moving it through the stub's states.
  function lastEngineJobId(): string {
    const id = engine.submissions.at(-1)?.jobId;
    if (!id) throw new Error("The stub engine created no job");
    return id;
  }

  async function total(agent: Agent): Promise<number> {
    return jobPageSchema.parse((await agent.get("/api/jobs").expect(200)).body).total;
  }

  // Supertest buffers only text and JSON by default; a package is compared as bytes.
  function binary(response: Response, done: (error: Error | null, body: Buffer) => void): void {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => {
      done(null, Buffer.concat(chunks));
    });
  }

  it("needs a logged-in user", async () => {
    const response = await request(app.getHttpServer()).get("/api/jobs").expect(401);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });

  describe("POST /api/jobs", () => {
    it("queues a job owned by the caller, sending the Dataset and parameters to the engine unchanged", async () => {
      const response = await ada
        .post("/api/jobs")
        .send({ dataset: "smoke", parameters: { bounds, source: "LM" } })
        .expect(201);

      expect(jobSchema.parse(response.body)).toMatchObject({
        userId: adaId,
        dataset: "smoke",
        parameters: { bounds, source: "LM" },
        state: "queued",
        progress: null,
        error: null,
        completedAt: null,
      });
      expect(response.body).not.toHaveProperty("engineJobId");
      expect(engine.submissions.map((submission) => submission.body)).toEqual([
        { dataset: "smoke", parameters: { bounds, source: "LM" } },
      ]);
    });

    it("rejects an invalid body without asking the engine", async () => {
      const response = await ada
        .post("/api/jobs")
        .send({ parameters: { bounds, format: "geojson" }, target: "local" })
        .expect(400);

      const error = errorResponseSchema.parse(response.body).error;
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.errors?.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["dataset", "parameters.format"]),
      );
      expect(error.errors?.some((issue) => issue.message.includes("target"))).toBe(true);
      expect(engine.submissions).toEqual([]);
    });

    it("answers the parameters the engine rejects as VALIDATION_FAILED, and records no job", async () => {
      engine.rejectNextSubmit(422, [{ loc: ["bounds"], type: "too_short" }]);

      const response = await ada
        .post("/api/jobs")
        .send({ dataset: "smoke", parameters: { bounds: [1] } })
        .expect(400);

      expect(errorResponseSchema.parse(response.body).error).toMatchObject({
        code: "VALIDATION_FAILED",
        errors: [{ path: "parameters.bounds", message: "too_short" }],
      });
      expect(await total(ada)).toBe(0);
    });

    it("answers other engine rejections as BAD_REQUEST with the engine's message, and records no job", async () => {
      engine.rejectNextSubmit(422, "Dataset 'smoke' is not registered");

      const response = await ada.post("/api/jobs").send({ dataset: "smoke", parameters: { bounds } }).expect(400);

      expect(errorResponseSchema.parse(response.body).error).toMatchObject({
        code: "BAD_REQUEST",
        message: "Dataset 'smoke' is not registered",
      });
      expect(await total(ada)).toBe(0);
    });

    it("answers SERVICE_UNAVAILABLE while the engine is unreachable, and records no job", async () => {
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      engine.setReachable(false);

      const response = await ada.post("/api/jobs").send({ dataset: "smoke", parameters: { bounds } }).expect(503);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("SERVICE_UNAVAILABLE");
      engine.setReachable(true);
      expect(await total(ada)).toBe(0);
    });

    // The engine says such a job may still run, so it is recorded and followed, never submitted again.
    it("records a job the engine's queue didn't confirm, and follows it", async () => {
      engine.unconfirmNextSubmit();

      const job = await submit(ada);
      expect(job.state).toBe("queued");

      engine.setJob(lastEngineJobId(), "running");
      expect((await read(ada, job.id)).state).toBe("running");
      expect(engine.submissions).toHaveLength(1);
    });
  });

  describe("GET /api/jobs/:id", () => {
    it("follows the engine's state and progress", async () => {
      const job = await submit(ada);
      const engineJobId = lastEngineJobId();

      engine.setJob(engineJobId, "unconfirmed");
      expect(await read(ada, job.id)).toMatchObject({ state: "queued", progress: null });

      engine.setJob(engineJobId, "running", {
        percent: 50,
        message: "halfway",
        phase: "meshing",
        phases: ["download", "meshing"],
        eta_seconds: 12,
      });
      const running = await read(ada, job.id);
      expect(running).toMatchObject({ state: "running", error: null, completedAt: null });
      expect(running.progress).toEqual({ percent: 50, message: "halfway", phase: "meshing" });

      engine.setJob(engineJobId, "running", null);
      expect(await read(ada, job.id)).toMatchObject({ state: "running", progress: null });
    });

    it("marks a job the engine failed as failed, naming the error, and stops asking the engine", async () => {
      const job = await submit(ada);
      engine.failJob(lastEngineJobId(), "RuntimeError");

      const failed = await read(ada, job.id);
      expect(failed).toMatchObject({ state: "failed", progress: null, error: "The job failed (RuntimeError)" });

      engine.forgetJob(lastEngineJobId());
      expect(await read(ada, job.id)).toEqual(failed);
    });

    it("marks a job the engine no longer has as failed", async () => {
      const job = await submit(ada);
      engine.forgetJob(lastEngineJobId());

      expect(await read(ada, job.id)).toMatchObject({ state: "failed", error: "The engine no longer has this job" });
    });

    it("answers the last known state while the engine is unreachable", async () => {
      const job = await submit(ada);
      engine.setJob(lastEngineJobId(), "running", { percent: 30, message: "meshing", phase: null });
      const running = await read(ada, job.id);

      engine.setReachable(false);

      expect(await read(ada, job.id)).toEqual(running);
    });

    it("answers NOT_FOUND for another user's job, as for one that does not exist", async () => {
      const graces = await submit(grace);

      const other = await ada.get(`/api/jobs/${graces.id}`).expect(404);
      const missing = await ada.get(`/api/jobs/${missingId}`).expect(404);

      expect(errorResponseSchema.parse(other.body).error.code).toBe("NOT_FOUND");
      expect(errorResponseSchema.parse(missing.body).error.code).toBe("NOT_FOUND");
    });

    it("rejects an id that is not a UUID", async () => {
      const response = await ada.get("/api/jobs/not-a-uuid").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["id"]);
    });
  });

  describe("GET /api/jobs", () => {
    it("lists only the user's own jobs, newest first, paged with limit and offset", async () => {
      const first = await submit(ada);
      await submit(grace);
      const second = await submit(ada);

      const all = jobPageSchema.parse((await ada.get("/api/jobs").expect(200)).body);
      expect(all).toMatchObject({ limit: 20, offset: 0, total: 2 });
      expect(all.items.map((job) => job.id)).toEqual([second.id, first.id]);

      const page = jobPageSchema.parse((await ada.get("/api/jobs?limit=1&offset=1").expect(200)).body);
      expect(page).toMatchObject({ limit: 1, offset: 1, total: 2 });
      expect(page.items.map((job) => job.id)).toEqual([first.id]);
    });

    it("brings the listed unfinished jobs up to date", async () => {
      const job = await submit(ada);
      engine.setJob(lastEngineJobId(), "running", { percent: 10, message: "starting", phase: null });

      const list = jobPageSchema.parse((await ada.get("/api/jobs").expect(200)).body);

      expect(list.items).toEqual([expect.objectContaining({ id: job.id, state: "running" })]);
    });
  });

  describe("GET /api/jobs/:id/package", () => {
    const packageBytes = randomBytes(4096);

    it("completes a job once its package is stored, and serves that package", async () => {
      const job = await submit(ada);
      engine.completeJob(lastEngineJobId(), packageBytes);

      const completed = await read(ada, job.id);
      expect(completed).toMatchObject({ state: "completed", progress: null, error: null });
      expect(completed.completedAt).not.toBeNull();

      const response = await ada.get(`/api/jobs/${job.id}/package`).buffer(true).parse(binary).expect(200);
      expect(response.headers["content-type"]).toBe("application/zip");
      expect(response.headers["content-disposition"]).toBe(`attachment; filename="smoke-${job.id}.dtccpkg"`);
      expect(response.body).toEqual(packageBytes);
    });

    it("serves a completed job's package from its own storage, without the engine", async () => {
      const job = await submit(ada);
      engine.completeJob(lastEngineJobId(), packageBytes);
      const completed = await read(ada, job.id);

      engine.setReachable(false);

      expect(await read(ada, job.id)).toEqual(completed);
      const response = await ada.get(`/api/jobs/${job.id}/package`).buffer(true).parse(binary).expect(200);
      expect(response.body).toEqual(packageBytes);
    });

    it("keeps a job's state while its package can't be downloaded, and completes it once it can", async () => {
      const job = await submit(ada);
      engine.completeJob(lastEngineJobId(), packageBytes, { served: false });

      expect(await read(ada, job.id)).toMatchObject({ state: "queued", completedAt: null });
      await ada.get(`/api/jobs/${job.id}/package`).expect(409);

      engine.completeJob(lastEngineJobId(), packageBytes);
      expect((await read(ada, job.id)).state).toBe("completed");
    });

    it("marks a job the engine completed without a package as failed", async () => {
      const job = await submit(ada);
      engine.completeJob(lastEngineJobId(), packageBytes, { available: false });

      expect(await read(ada, job.id)).toMatchObject({
        state: "failed",
        error: "The engine has no package for this job",
        completedAt: null,
      });
    });

    it("answers CONFLICT for a job that hasn't completed", async () => {
      const queued = await submit(ada);
      const running = await submit(ada);
      engine.setJob(lastEngineJobId(), "running");
      const failed = await submit(ada);
      engine.failJob(lastEngineJobId(), "RuntimeError");

      for (const job of [queued, running, failed]) {
        const response = await ada.get(`/api/jobs/${job.id}/package`).expect(409);
        expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
      }
    });

    it("answers NOT_FOUND for another user's job, as for one that does not exist", async () => {
      const graces = await submit(grace);
      engine.completeJob(lastEngineJobId(), packageBytes);

      const other = await ada.get(`/api/jobs/${graces.id}/package`).expect(404);
      const missing = await ada.get(`/api/jobs/${missingId}/package`).expect(404);

      expect(errorResponseSchema.parse(other.body).error.code).toBe("NOT_FOUND");
      expect(errorResponseSchema.parse(missing.body).error.code).toBe("NOT_FOUND");
    });
  });
});
