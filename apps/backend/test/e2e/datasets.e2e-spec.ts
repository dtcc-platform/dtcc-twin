import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { datasetPageSchema, datasetSchema, errorResponseSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/create-test-app.js";

// The fake engine serves the recorded fixtures: every Core and Sim descriptor, and packages for these two only.
const runnable = ["building_footprints", "deso"];

describe("Datasets (e2e)", () => {
  let app: INestApplication<App>;
  let recordedNames: string[];

  beforeAll(async () => {
    app = await createTestApp();
    const descriptors = JSON.parse(await readFile("fixtures/engine/descriptors.json", "utf8")) as { name: string }[];
    recordedNames = descriptors.map((descriptor) => descriptor.name);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/datasets", () => {
    it("lists every recorded Dataset to anyone, without a login", async () => {
      const response = await request(app.getHttpServer()).get("/api/datasets?limit=100").expect(200);

      const page = datasetPageSchema.parse(response.body);
      expect(page.total).toBe(recordedNames.length);
      expect(page.items.map((dataset) => dataset.name)).toEqual(recordedNames);
    });

    it("marks only the Datasets the engine can run as available", async () => {
      const response = await request(app.getHttpServer()).get("/api/datasets?limit=100").expect(200);

      const available = datasetPageSchema
        .parse(response.body)
        .items.filter((dataset) => dataset.available)
        .map((dataset) => dataset.name);
      expect(available).toEqual(runnable);
    });

    it("pages with limit and offset", async () => {
      const response = await request(app.getHttpServer()).get("/api/datasets?limit=2&offset=1").expect(200);

      const page = datasetPageSchema.parse(response.body);
      expect(page).toMatchObject({ limit: 2, offset: 1, total: recordedNames.length });
      expect(page.items.map((dataset) => dataset.name)).toEqual(recordedNames.slice(1, 3));
    });

    it("rejects an invalid page", async () => {
      const response = await request(app.getHttpServer()).get("/api/datasets?limit=0").expect(400);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("GET /api/datasets/:name", () => {
    it("describes one Dataset in the API's own field names, with its parameter schema", async () => {
      const response = await request(app.getHttpServer()).get("/api/datasets/building_footprints").expect(200);

      expect(Object.keys(response.body as object).sort()).toEqual(Object.keys(datasetSchema.shape).sort());
      const dataset = datasetSchema.parse(response.body);
      expect(dataset).toMatchObject({
        name: "building_footprints",
        title: "Building Footprints",
        dataCategory: "raw",
        resultKind: "building_footprints",
        available: true,
      });
      expect(dataset.argsSchema).toHaveProperty("properties.bounds");
    });

    it("describes a Dataset the engine can't run as unavailable", async () => {
      const response = await request(app.getHttpServer()).get("/api/datasets/urban_wind_simulation").expect(200);

      expect(datasetSchema.parse(response.body)).toMatchObject({ dataCategory: "simulation", available: false });
    });

    it("answers 404 for an unknown Dataset", async () => {
      const response = await request(app.getHttpServer()).get("/api/datasets/no_such_dataset").expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });

    it("rejects a name that isn't a Dataset name", async () => {
      const response = await request(app.getHttpServer()).get("/api/datasets/Not%20A%20Name").expect(400);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });
  });
});
