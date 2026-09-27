import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ConfigModule.forRoot runs when app.module.ts is imported, so the env must be in place before that.
vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "production");
});
const { createTestApp } = await import("../helpers/create-test-app.js");

describe("Auth cookies in production (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("are prefixed and Secure", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "ada@example.com", name: "Ada", password: "correct horse" })
      .expect(201);

    const cookies = response.headers["set-cookie"] as string[] | undefined;
    expect(cookies).toEqual([
      expect.stringMatching(/^__Host-access_token=.*; Path=\/;.*; HttpOnly; Secure; SameSite=Lax$/),
      expect.stringMatching(/^__Secure-refresh_token=.*; Path=\/api\/auth;.*; HttpOnly; Secure; SameSite=Lax$/),
    ]);
  });
});
