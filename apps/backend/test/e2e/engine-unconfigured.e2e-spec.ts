import { Logger, type INestApplication } from "@nestjs/common";
import { errorResponseSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ConfigModule reads the environment when app.module.ts is imported. Empty, as .env.example ships them, so a
// variable set in the shell can't configure an engine here.
vi.hoisted(() => {
  vi.stubEnv("ENGINE_URL", "");
  vi.stubEnv("ENGINE_API_TOKEN", "");
});
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");

describe("Without a configured engine (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("answers the engine's routes with SERVICE_UNAVAILABLE", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const response = await request(app.getHttpServer())
      .get("/api/datasets")
      .set(await authHeader("user"))
      .expect(503);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("answers a job submission with SERVICE_UNAVAILABLE", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const response = await request(app.getHttpServer())
      .post("/api/jobs")
      .set(await authHeader("user"))
      .send({ dataset: "smoke", parameters: {} })
      .expect(503);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("still reports ready, since the engine is optional", async () => {
    await request(app.getHttpServer()).get("/api/health/ready").expect(200);
  });
});
