import { Controller, Get, Post, Req, SerializeOptions } from "@nestjs/common";
import { errorResponseSchema } from "@repo/contracts";
import type { Request } from "express";
import request from "supertest";
import { Public } from "../../src/common/decorators/auth.decorators.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NestExpressApplication } from "@nestjs/platform-express";

// ConfigModule.forRoot runs when app.module.ts is imported, so the env must be in place before that.
vi.hoisted(() => {
  vi.stubEnv("CORS_ORIGINS", "http://localhost:3000, https://app.example.com");
});
const { createTestApp } = await import("../helpers/create-test-app.js");

const cookiesSchema = z.object({ session: z.string().optional() });

// Public, so this spec stays about the HTTP pipeline; the guard has its own.
@Controller("test")
@Public()
class TestController {
  @Get("cookies")
  @SerializeOptions({ schema: cookiesSchema })
  cookies(@Req() req: Request): z.infer<typeof cookiesSchema> {
    return req.cookies as z.infer<typeof cookiesSchema>;
  }

  @Post("echo")
  @SerializeOptions({ schema: z.object({ size: z.number() }) })
  echo(@Req() req: Request): { size: number } {
    return { size: JSON.stringify(req.body).length };
  }
}

describe("configureApp (e2e)", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [TestController] });
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("sends security headers and hides the framework", async () => {
    const response = await request(app.getHttpServer()).get("/api/test/cookies").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers).not.toHaveProperty("x-powered-by");
  });

  it("answers a preflight from a listed origin with credentials allowed", async () => {
    const response = await request(app.getHttpServer())
      .options("/api/test/echo")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not allow an origin outside the list", async () => {
    const response = await request(app.getHttpServer())
      .options("/api/test/echo")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(response.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("parses cookies for handlers", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/test/cookies")
      .set("Cookie", "session=abc123")
      .expect(200);

    expect(response.body).toEqual({ session: "abc123" });
  });

  it("accepts a JSON body above Express's 100kb default", async () => {
    const body = { blob: "x".repeat(2 * 1024 * 1024) };

    await request(app.getHttpServer()).post("/api/test/echo").send(body).expect(201);
  });

  it("rejects a JSON body above the limit with a PAYLOAD_TOO_LARGE error", async () => {
    const body = { blob: "x".repeat(21 * 1024 * 1024) };

    const response = await request(app.getHttpServer()).post("/api/test/echo").send(body).expect(413);

    expect(errorResponseSchema.parse(response.body).error).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("registers shutdown hooks and releases them on close", async () => {
    const baseline = process.listenerCount("SIGTERM");
    const other = await createTestApp();

    expect(process.listenerCount("SIGTERM")).toBe(baseline + 1);
    await other.close();
    expect(process.listenerCount("SIGTERM")).toBe(baseline);
  });
});
