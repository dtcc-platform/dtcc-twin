import { Controller, Get, type INestApplication } from "@nestjs/common";
import { errorResponseSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUser, Public, Roles, type AuthUser } from "../../src/common/decorators/auth.decorators.js";
import { accessToken, authHeader } from "../helpers/auth.js";
import { createTestApp } from "../helpers/create-test-app.js";

@Controller("guarded")
class GuardedController {
  @Get("public")
  @Public()
  open(): { ok: true } {
    return { ok: true };
  }

  @Get("user")
  @Roles("user")
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Get("admin")
  adminOnly(): { ok: true } {
    return { ok: true };
  }
}

const ada: AuthUser = {
  userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
  sessionId: "0199a6b4-7c1e-7d2a-9f3b-000000000001",
  role: "user",
};

describe("AuthGuard (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [GuardedController] });
  });

  afterAll(async () => {
    await app.close();
  });

  function get(path: string) {
    return request(app.getHttpServer()).get(`/api/guarded/${path}`);
  }

  it("lets anyone call a @Public() route", async () => {
    const response = await get("public").expect(200);

    expect(response.body).toEqual({ ok: true });
  });

  it.each([
    ["no credentials", {}],
    ["a token that is not valid", { Authorization: "Bearer not-a-token" }],
    ["a scheme other than Bearer", { Authorization: "Basic YWRhOnBhc3N3b3Jk" }],
  ])("answers 401 UNAUTHORIZED to %s", async (_, headers) => {
    const response = await get("user").set(headers).expect(401);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });

  it("hands the token's user to the handler through @CurrentUser()", async () => {
    const response = await get("user")
      .set(await authHeader("user", ada))
      .expect(200);

    expect(response.body).toEqual(ada);
  });

  it("reads the token from the access cookie when there is no Authorization header", async () => {
    const response = await get("user")
      .set("Cookie", `access_token=${await accessToken(ada)}`)
      .expect(200);

    expect(response.body).toEqual(ada);
  });

  it("makes a route without @Roles or @Public admin-only, answering 403 FORBIDDEN to a user", async () => {
    const response = await get("admin")
      .set(await authHeader("user"))
      .expect(403);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("FORBIDDEN");
  });

  it("lets an admin through every role check", async () => {
    const admin = await authHeader("admin");

    const adminRoute = await get("admin").set(admin).expect(200);
    const userRoute = await get("user").set(admin).expect(200);

    expect(adminRoute.body).toEqual({ ok: true });
    expect(userRoute.body).toMatchObject({ role: "admin" });
  });

  it("protects the app's own routes and leaves health public", async () => {
    await request(app.getHttpServer()).get("/api/users").expect(401);
    await request(app.getHttpServer()).get("/api/health/live").expect(200);
  });
});
