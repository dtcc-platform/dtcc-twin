import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, jobPageSchema, jobResultSchema, jobSchema, type Job } from "@repo/contracts";
import request, { type Response } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../helpers/create-test-app.js";
import { truncateAllTables } from "../helpers/database.js";

// The recorded demo area; the fake engine returns the same packages whatever area is asked for.
const bounds = [319370, 6397790, 319996, 6398431];
const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";

// Supertest buffers only text and JSON by default; artifacts and packages are compared as bytes.
function binary(response: Response, done: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk));
  response.on("end", () => {
    done(null, Buffer.concat(chunks));
  });
}

describe("Jobs (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // The fake engine derives a job's state from the time since it was submitted: about 2 s queued, 8 s running.
  // Only Date is faked, so the server, the database driver and supertest keep their real timers.
  beforeEach(async () => {
    await truncateAllTables();
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function wait(seconds: number): void {
    vi.setSystemTime(Date.now() + seconds * 1000);
  }

  async function submit(dataset: string, parameters: Record<string, unknown> = { bounds }): Promise<Job> {
    const response = await request(app.getHttpServer()).post("/api/jobs").send({ dataset, parameters }).expect(201);
    return jobSchema.parse(response.body);
  }

  async function getJob(id: string): Promise<Job> {
    const response = await request(app.getHttpServer()).get(`/api/jobs/${id}`).expect(200);
    return jobSchema.parse(response.body);
  }

  describe("POST /api/jobs", () => {
    it("queues a job for anyone, without a login", async () => {
      const job = await submit("building_footprints", { bounds, source: "LM" });

      expect(job).toMatchObject({
        dataset: "building_footprints",
        parameters: { bounds, source: "LM" },
        state: "queued",
        progress: null,
        error: null,
        completedAt: null,
      });
    });

    it("rejects malformed bounds with the path of the issue", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/jobs")
        .send({ dataset: "building_footprints", parameters: { bounds: [10, 0, 0, 10] } })
        .expect(400);

      const error = errorResponseSchema.parse(response.body).error;
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.errors?.map((issue) => issue.path)).toEqual(["parameters.bounds"]);
    });

    it("answers 404 for an unknown Dataset", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/jobs")
        .send({ dataset: "no_such_dataset", parameters: { bounds } })
        .expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });

    it("refuses a Dataset the engine can't run, instead of queueing a job that can only fail", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/jobs")
        .send({ dataset: "urban_wind_simulation", parameters: { bounds } })
        .expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
    });
  });

  describe("GET /api/jobs/:id", () => {
    it("reports the progress Core recorded while the job runs, then completes", async () => {
      const { id } = await submit("building_footprints");

      wait(3);
      expect(await getJob(id)).toMatchObject({
        state: "running",
        progress: { percent: 0, phase: "download_footprints", message: "Downloading building footprints..." },
      });

      wait(4);
      expect((await getJob(id)).progress).toMatchObject({ percent: 20 });

      wait(4);
      const completed = await getJob(id);
      expect(completed).toMatchObject({ state: "completed", progress: null, error: null });
      expect(completed.completedAt).not.toBeNull();
    });

    it("reports no progress for a running job when Core measured none", async () => {
      const { id } = await submit("deso");

      wait(5);
      expect(await getJob(id)).toMatchObject({ state: "running", progress: null });
    });

    it("answers 404 for an unknown job and 400 for an id that isn't one", async () => {
      await request(app.getHttpServer()).get(`/api/jobs/${missingId}`).expect(404);
      await request(app.getHttpServer()).get("/api/jobs/not-an-id").expect(400);
    });
  });

  describe("GET /api/jobs", () => {
    it("lists jobs newest first, each brought up to date", async () => {
      const older = await submit("building_footprints");
      wait(1);
      const newer = await submit("deso");
      wait(11);

      const response = await request(app.getHttpServer()).get("/api/jobs").expect(200);

      const page = jobPageSchema.parse(response.body);
      expect(page.total).toBe(2);
      expect(page.items.map((job) => [job.id, job.state])).toEqual([
        [newer.id, "completed"],
        [older.id, "completed"],
      ]);
    });
  });

  describe("results", () => {
    async function completed(dataset: string): Promise<Job> {
      const job = await submit(dataset);
      wait(11);
      return getJob(job.id);
    }

    it("describes a completed job's result from its package manifest", async () => {
      const { id } = await completed("building_footprints");

      const response = await request(app.getHttpServer()).get(`/api/jobs/${id}/result`).expect(200);

      const result = jobResultSchema.parse(response.body);
      expect(result).toMatchObject({
        schemaVersion: "dtcc-dataset-manifest-v2",
        title: "Building Footprints",
        headline: "Building Footprint Alignment Layer",
        providers: ["Lantmäteriet", "OpenStreetMap", "DTCC Platform"],
        generatedBy: "dtcc-core 0.9.8dev",
        artifacts: [
          {
            file: "building_footprints.geojson",
            role: "primary",
            format: "geojson",
            mediaType: "application/geo+json",
            crs: "EPSG:3006",
          },
        ],
      });
      expect(result.parameters).toMatchObject({ bounds, source: "LM" });
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.limitations.length).toBeGreaterThan(0);
    });

    it("describes a canonical package, whose only artifact is the protobuf model", async () => {
      const { id } = await completed("deso");

      const response = await request(app.getHttpServer()).get(`/api/jobs/${id}/result`).expect(200);

      expect(jobResultSchema.parse(response.body)).toMatchObject({
        schemaVersion: "dtcc-dataset-manifest-v3",
        artifacts: [{ file: "model.dtcc", role: "canonical_model", mediaType: "application/vnd.dtcc.model+protobuf" }],
      });
    });

    it("serves an artifact with its media type", async () => {
      const { id } = await completed("building_footprints");

      const response = await request(app.getHttpServer())
        .get(`/api/jobs/${id}/artifacts/building_footprints.geojson`)
        .buffer(true)
        .parse(binary)
        .expect(200);

      expect(response.headers["content-type"]).toContain("application/geo+json");
      const geojson = JSON.parse((response.body as Buffer).toString("utf8")) as { type: string; features: unknown[] };
      expect(geojson.type).toBe("FeatureCollection");
      expect(geojson.features.length).toBeGreaterThan(0);
    });

    it("serves the whole package as a download", async () => {
      const { id } = await completed("building_footprints");

      const response = await request(app.getHttpServer())
        .get(`/api/jobs/${id}/package`)
        .buffer(true)
        .parse(binary)
        .expect(200);

      expect(response.headers["content-disposition"]).toBe('attachment; filename="building_footprints.dtccpkg"');
      expect(response.body).toEqual(await readFile("fixtures/engine/building_footprints.dtccpkg"));
    });

    it("answers 404 for a file the package doesn't list", async () => {
      const { id } = await completed("building_footprints");

      await request(app.getHttpServer()).get(`/api/jobs/${id}/artifacts/manifest.json`).expect(404);
    });

    it("answers 409 for the result, artifacts and package of a job that hasn't completed", async () => {
      const { id } = await submit("building_footprints");

      for (const path of ["result", "artifacts/building_footprints.geojson", "package"]) {
        const response = await request(app.getHttpServer()).get(`/api/jobs/${id}/${path}`).expect(409);
        expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
      }
    });
  });
});
