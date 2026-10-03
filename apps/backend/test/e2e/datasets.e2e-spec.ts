import { Logger, type INestApplication } from "@nestjs/common";
import { datasetListSchema, errorResponseSchema } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { descriptor, startStubEngine } from "../helpers/stub-engine.js";

// ConfigModule reads the environment when app.module.ts is imported, so the stub must be listening before that.
const engine = await startStubEngine();
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", engine.token);
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");

describe("Datasets (e2e)", () => {
  let app: INestApplication<App>;
  let user: Agent;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await engine.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    engine.reset();
    engine.setDatasets([
      descriptor("urban_heat_simulation", {
        title: "Urban heat simulation",
        description: "Air temperature over a city volume mesh",
        data_category: "simulation",
        result_kind: "field",
        timeout_hint: 600,
      }),
      descriptor("smoke"),
      descriptor("city_volume_mesh"),
    ]);
    user = request.agent(app.getHttpServer()).set(await authHeader("user"));
  });

  it("needs a logged-in user", async () => {
    const response = await request(app.getHttpServer()).get("/api/datasets").expect(401);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });

  describe("GET /api/datasets", () => {
    // Not paged: the engine returns its whole catalog, and clients such as a Dataset picker need all of it.
    it("lists every Dataset the engine has, sorted by name", async () => {
      const list = datasetListSchema.parse((await user.get("/api/datasets").expect(200)).body);

      expect(list.items.map((dataset) => dataset.name)).toEqual(["city_volume_mesh", "smoke", "urban_heat_simulation"]);
    });

    // The raw body, not a parsed one: parsing would hide engine fields the API failed to drop.
    it("answers each Dataset in the API's shape, without the engine's other fields", async () => {
      const response = await user.get("/api/datasets").expect(200);

      const items = (response.body as { items: { name: string }[] }).items;
      expect(items.filter((dataset) => dataset.name === "urban_heat_simulation")).toEqual([
        {
          name: "urban_heat_simulation",
          title: "Urban heat simulation",
          description: "Air temperature over a city volume mesh",
          dataCategory: "simulation",
          resultKind: "field",
          argsSchema: { type: "object", properties: { bounds: { type: "array" } }, required: ["bounds"] },
          timeoutHint: 600,
        },
      ]);
    });
  });

  describe("GET /api/datasets/:name", () => {
    it("returns one Dataset in the API's shape", async () => {
      const response = await user.get("/api/datasets/smoke").expect(200);

      expect(response.body).toEqual({
        name: "smoke",
        title: "Title of smoke",
        description: "Description of smoke",
        dataCategory: "derived",
        resultKind: "mesh",
        argsSchema: { type: "object", properties: { bounds: { type: "array" } }, required: ["bounds"] },
        timeoutHint: null,
      });
    });

    it("answers NOT_FOUND for a Dataset the engine doesn't have", async () => {
      const response = await user.get("/api/datasets/no_such_dataset").expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });

    it("rejects an invalid name before asking the engine", async () => {
      const response = await user.get("/api/datasets/Not-A-Name").expect(400);

      const error = errorResponseSchema.parse(response.body).error;
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.errors?.map((issue) => issue.path)).toEqual(["name"]);
    });
  });

  it("answers SERVICE_UNAVAILABLE while the engine is unreachable", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    engine.setReachable(false);

    const list = await user.get("/api/datasets").expect(503);
    const one = await user.get("/api/datasets/smoke").expect(503);

    // A fixed message: the reason, with the engine's address, belongs in the backend's log only.
    const unavailable = { code: "SERVICE_UNAVAILABLE", message: "DTCC Engine is unavailable" };
    expect(errorResponseSchema.parse(list.body).error).toMatchObject(unavailable);
    expect(errorResponseSchema.parse(one.body).error).toMatchObject(unavailable);
  });
});
