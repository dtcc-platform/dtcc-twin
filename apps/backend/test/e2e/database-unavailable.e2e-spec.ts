import { Logger, type INestApplication } from "@nestjs/common";
import { errorResponseSchema, healthStatusSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ConfigModule.forRoot runs when app.module.ts is imported, so the env must be in place before that.
// Port 1 on loopback refuses at once, standing in for a database that is down or not yet reachable.
vi.hoisted(() => {
  vi.stubEnv("DATABASE_URL", "postgres://app:app@127.0.0.1:1/app");
});
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");

describe("Without a reachable database (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("still boots and serves the OpenAPI document, which CI generates with no database", async () => {
    await request(app.getHttpServer()).get("/api/docs/openapi.json").expect(200);
  });

  it("stays live but reports not ready", async () => {
    const live = await request(app.getHttpServer()).get("/api/health/live").expect(200);
    expect(healthStatusSchema.parse(live.body)).toEqual({ status: "ok" });

    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const ready = await request(app.getHttpServer()).get("/api/health/ready").expect(503);
    expect(errorResponseSchema.parse(ready.body).error).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable",
    });
  });

  it("answers a request that needs the database with SERVICE_UNAVAILABLE, not a 500", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const response = await request(app.getHttpServer())
      .get("/api/users")
      .set(await authHeader("admin"))
      .expect(503);

    expect(errorResponseSchema.parse(response.body).error).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable",
    });
  });
});
