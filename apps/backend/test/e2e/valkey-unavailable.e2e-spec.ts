import { Logger, type INestApplication } from "@nestjs/common";
import { errorResponseSchema, healthStatusSchema } from "@repo/contracts";
import { Valkey } from "iovalkey";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ConfigModule.forRoot runs when app.module.ts is imported, so the env must be in place before that.
// Port 1 on loopback refuses at once, standing in for a Valkey that is down or not yet reachable.
vi.hoisted(() => {
  vi.stubEnv("VALKEY_URL", "redis://127.0.0.1:1");
});
const { createTestApp } = await import("../helpers/create-test-app.js");

describe("Without a reachable Valkey (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // The client logs each failed reconnect.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("still boots and stays live, but reports not ready", async () => {
    const live = await request(app.getHttpServer()).get("/api/health/live").expect(200);
    expect(healthStatusSchema.parse(live.body)).toEqual({ status: "ok" });

    const ready = await request(app.getHttpServer()).get("/api/health/ready").expect(503);
    expect(errorResponseSchema.parse(ready.body).error).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Valkey unavailable",
    });
  });

  it("fails a command at once instead of queuing it until Valkey is back", async () => {
    const started = performance.now();

    await expect(app.get(Valkey).ping()).rejects.toThrow();

    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
