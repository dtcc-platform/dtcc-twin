import type { INestApplication } from "@nestjs/common";
import { datasetListSchema, datasetSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { descriptor, startStubEngine } from "../helpers/stub-engine.js";

// Deployed, the backend reaches the engine only through dtcc-infra's API gateway, which admits it by its consumer key
// and supplies the engine's token itself. ConfigModule reads the environment when app.module.ts is imported.
const engine = await startStubEngine("stub-engine-token", { gatewayKey: "stub-gateway-key" });
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", "");
vi.stubEnv("ENGINE_GATEWAY_KEY", "stub-gateway-key");
const { createTestApp } = await import("../helpers/create-test-app.js");

describe("The engine behind the API gateway (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await engine.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    engine.reset();
    engine.setDatasets([descriptor("smoke")]);
  });

  it("sends ENGINE_GATEWAY_KEY as the gateway's apikey header", async () => {
    const list = datasetListSchema.parse((await request(app.getHttpServer()).get("/api/datasets").expect(200)).body);
    const dataset = datasetSchema.parse(
      (await request(app.getHttpServer()).get("/api/datasets/smoke").expect(200)).body,
    );

    expect(list.items.map(({ name }) => name)).toEqual(["smoke"]);
    expect(dataset.name).toBe("smoke");
  });
});
