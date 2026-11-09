import { Logger, type INestApplication } from "@nestjs/common";
import { errorResponseSchema, healthStatusSchema } from "@repo/contracts";
import type { Valkey } from "iovalkey";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStubEngine } from "../helpers/stub-engine.js";

// ConfigModule.forRoot runs when app.module.ts is imported, so the env must be in place before that.
// Port 1 on loopback refuses at once, standing in for a Valkey that is down or not yet reachable.
vi.hoisted(() => {
  vi.stubEnv("VALKEY_URL", "redis://127.0.0.1:1");
});
// An engine is configured, so a refused submission shows it never reached one.
const engine = await startStubEngine();
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", engine.token);
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { VALKEY } = await import("../../src/infra/valkey/valkey.module.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");

describe("Without a reachable Valkey (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // The client logs each failed reconnect.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await engine.close();
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

    await expect(app.get<Valkey>(VALKEY).ping()).rejects.toThrow();

    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("answers a job submission with SERVICE_UNAVAILABLE, sending nothing to the engine", async () => {
    const user = await app
      .get(UsersService)
      .create({ email: "ada@example.com", name: "Ada", password: "correct horse" });

    const response = await request(app.getHttpServer())
      .post("/api/jobs")
      .set(await authHeader("user", { userId: user.id }))
      .send({ dataset: "smoke", parameters: {} })
      .expect(503);

    expect(errorResponseSchema.parse(response.body).error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Valkey unavailable",
    });
    expect(engine.submissions).toEqual([]);
  });

  // A client left reconnecting keeps the process alive after shutdown.
  it("ends the client on shutdown, though it never connected", async () => {
    const closing = await createTestApp();
    const valkey = closing.get<Valkey>(VALKEY);

    await closing.close();

    await vi.waitFor(() => {
      expect(valkey.status).toBe("end");
    });
  });
});
