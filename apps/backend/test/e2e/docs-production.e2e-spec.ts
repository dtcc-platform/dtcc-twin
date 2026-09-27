import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, it, vi } from "vitest";

// ConfigModule.forRoot runs when app.module.ts is imported, so the env must be in place before that.
vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "production");
});
const { createTestApp } = await import("../helpers/create-test-app.js");

describe("API docs in production (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("are not mounted", async () => {
    await request(app.getHttpServer()).get("/api/docs").expect(404);
    await request(app.getHttpServer()).get("/api/docs/openapi.json").expect(404);
  });
});
