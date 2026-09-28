import { Logger, type INestApplication } from "@nestjs/common";
import { errorResponseSchema, healthStatusSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { HealthService } from "../../src/modules/health/health.service.js";
import { createTestApp } from "../helpers/create-test-app.js";

describe("Health (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health/live answers while the process runs", async () => {
    const response = await request(app.getHttpServer()).get("/api/health/live").expect(200);

    expect(healthStatusSchema.parse(response.body)).toEqual({ status: "ok" });
  });

  it("GET /api/health/ready answers while the database is reachable", async () => {
    const response = await request(app.getHttpServer()).get("/api/health/ready").expect(200);

    expect(healthStatusSchema.parse(response.body)).toEqual({ status: "ok" });
  });

  // Shutdown cannot be undone, so this test gets its own app rather than spoiling the shared one.
  it("GET /api/health/ready refuses once shutdown begins", async () => {
    const shuttingDown = await createTestApp();
    onTestFinished(() => shuttingDown.close());
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    shuttingDown.get(HealthService).beforeApplicationShutdown();

    const response = await request(shuttingDown.getHttpServer()).get("/api/health/ready").expect(503);
    expect(errorResponseSchema.parse(response.body).error).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
  });
});
