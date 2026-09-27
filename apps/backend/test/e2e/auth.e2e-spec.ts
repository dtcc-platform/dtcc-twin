import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, sessionListSchema, userSchema, type SessionList } from "@repo/contracts";
import request, { type Agent, type Response } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { userAgentMaxLength } from "../../src/modules/auth/sessions.table.js";
import { UsersService } from "../../src/modules/users/users.service.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { truncateAllTables } from "../helpers/database.js";

const ada = { email: "ada@example.com", name: "Ada", password: "correct horse" };
const grace = { email: "grace@example.com", name: "Grace", password: "correct horse" };

/** The `Set-Cookie` headers of a response, by cookie name. */
function setCookies(response: Response): Record<string, string> {
  const header = response.headers["set-cookie"] as string[] | undefined;
  return Object.fromEntries((header ?? []).map((cookie) => [cookie.slice(0, cookie.indexOf("=")), cookie]));
}

/** The value a `Set-Cookie` header gives its cookie. */
function cookieValue(setCookie: string | undefined): string {
  return setCookie?.slice(setCookie.indexOf("=") + 1).split(";")[0] ?? "";
}

describe("Auth (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  /** A client that keeps cookies between requests, as a browser does. */
  function browser(): Agent {
    return request.agent(app.getHttpServer());
  }

  async function loggedIn(person: typeof ada, userAgent = "Firefox"): Promise<{ agent: Agent; login: Response }> {
    const agent = browser();
    const login = await agent
      .post("/api/auth/login")
      .set("User-Agent", userAgent)
      .send({ email: person.email, password: person.password })
      .expect(200);
    return { agent, login };
  }

  async function sessionsOf(agent: Agent): Promise<SessionList> {
    const response = await agent.get("/api/auth/sessions").expect(200);
    return sessionListSchema.parse(response.body);
  }

  /** Refreshes with exactly this refresh token, as a stolen or stale copy would be sent. */
  function refreshWith(refreshToken: string) {
    return request(app.getHttpServer()).post("/api/auth/refresh").set("Cookie", `refresh_token=${refreshToken}`);
  }

  describe("POST /api/auth/register", () => {
    it("creates a user with the user role and logs them in", async () => {
      const agent = browser();

      const response = await agent.post("/api/auth/register").send(ada).expect(201);

      expect(userSchema.parse(response.body)).toMatchObject({ email: ada.email, name: ada.name, role: "user" });
      expect((await sessionsOf(agent)).items).toHaveLength(1);
    });

    it("sets both cookies HttpOnly and SameSite=Lax, the refresh cookie for /api/auth only", async () => {
      const response = await browser().post("/api/auth/register").send(ada).expect(201);

      const { access_token: access, refresh_token: refresh } = setCookies(response);
      expect(access).toMatch(/; Max-Age=900; Path=\/; Expires=.*; HttpOnly; SameSite=Lax$/);
      expect(refresh).toMatch(/; Max-Age=2592000; Path=\/api\/auth; Expires=.*; HttpOnly; SameSite=Lax$/);
    });

    it("rejects an email that is taken with 409 CONFLICT", async () => {
      await browser().post("/api/auth/register").send(ada).expect(201);

      const response = await browser().post("/api/auth/register").send(ada).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
    });

    it("rejects a role, so nobody signs up as an admin", async () => {
      const response = await browser()
        .post("/api/auth/register")
        .send({ ...ada, role: "admin" })
        .expect(400);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await app.get(UsersService).create(ada);
    });

    it("logs in with the right password, returning the user and recording the browser", async () => {
      const { agent, login } = await loggedIn(ada, "Mozilla/5.0 Firefox/140.0");

      expect(userSchema.parse(login.body).email).toBe(ada.email);
      expect(Object.keys(setCookies(login))).toEqual(["access_token", "refresh_token"]);
      expect((await sessionsOf(agent)).items).toEqual([
        expect.objectContaining({ userAgent: "Mozilla/5.0 Firefox/140.0", current: true }),
      ]);
    });

    it("cuts a user agent longer than the column instead of failing the login", async () => {
      const { agent } = await loggedIn(ada, "x".repeat(userAgentMaxLength + 1));

      const [session] = (await sessionsOf(agent)).items;

      expect(session?.userAgent).toBe("x".repeat(userAgentMaxLength));
    });

    it("answers a wrong password and an unknown email alike, with 401 UNAUTHORIZED", async () => {
      const wrongPassword = await browser()
        .post("/api/auth/login")
        .send({ email: ada.email, password: "wrong horse" })
        .expect(401);
      const unknownEmail = await browser()
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: "wrong horse" })
        .expect(401);

      const wrongPasswordError = errorResponseSchema.parse(wrongPassword.body).error;
      const unknownEmailError = errorResponseSchema.parse(unknownEmail.body).error;
      expect(wrongPasswordError).toMatchObject({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      expect(unknownEmailError.message).toBe(wrongPasswordError.message);
      expect(setCookies(wrongPassword)).toEqual({});
    });
  });

  describe("GET /api/auth/me", () => {
    it("answers the logged-in user, which is how the frontend tells it is logged in", async () => {
      await app.get(UsersService).create(ada);
      const { agent } = await loggedIn(ada);

      const response = await agent.get("/api/auth/me").expect(200);

      expect(userSchema.parse(response.body)).toMatchObject({ email: ada.email, name: ada.name, role: "user" });
    });

    it("answers 401 when nobody is logged in", async () => {
      const response = await browser().get("/api/auth/me").expect(401);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("POST /api/auth/refresh", () => {
    beforeEach(async () => {
      await app.get(UsersService).create(ada);
    });

    it("renews the access cookie and extends the refresh cookie, whose token stays the same", async () => {
      const { agent, login } = await loggedIn(ada);
      const refreshToken = cookieValue(setCookies(login)["refresh_token"]);

      const response = await agent.post("/api/auth/refresh").expect(204);

      const renewed = setCookies(response);
      expect(Object.keys(renewed)).toEqual(["access_token", "refresh_token"]);
      expect(cookieValue(renewed["refresh_token"])).toBe(refreshToken);
      expect(renewed["refresh_token"]).toMatch(/; Max-Age=2592000;/);
      // The browser now holds the renewed cookies, and they work.
      expect((await sessionsOf(agent)).items).toHaveLength(1);
    });

    it("needs no access token, which has usually expired by the time a client refreshes", async () => {
      const { login } = await loggedIn(ada);

      const response = await refreshWith(cookieValue(setCookies(login)["refresh_token"])).expect(204);

      expect(Object.keys(setCookies(response))).toEqual(["access_token", "refresh_token"]);
    });

    it.each([
      ["no refresh cookie", ""],
      ["a refresh token it never issued", "refresh_token=made-up"],
    ])("answers 401 and clears the cookies given %s", async (_, cookie) => {
      const response = await request(app.getHttpServer()).post("/api/auth/refresh").set("Cookie", cookie).expect(401);

      const cleared = setCookies(response);
      expect(cleared["access_token"]).toMatch(/^access_token=; Path=\/; Expires=Thu, 01 Jan 1970/);
      expect(cleared["refresh_token"]).toMatch(/^refresh_token=; Path=\/api\/auth; Expires=Thu, 01 Jan 1970/);
    });
  });

  describe("POST /api/auth/logout", () => {
    beforeEach(async () => {
      await app.get(UsersService).create(ada);
    });

    it("ends this session only and clears the cookies", async () => {
      const phone = await loggedIn(ada);
      const laptop = await loggedIn(ada);
      const phoneRefreshToken = cookieValue(setCookies(phone.login)["refresh_token"]);

      const response = await phone.agent.post("/api/auth/logout").expect(204);

      expect(setCookies(response)["access_token"]).toMatch(/^access_token=;/);
      await refreshWith(phoneRefreshToken).expect(401);
      expect((await sessionsOf(laptop.agent)).items).toHaveLength(1);
    });

    it("succeeds when there is nothing to log out of", async () => {
      const response = await browser().post("/api/auth/logout").expect(204);

      expect(response.text).toBe("");
    });
  });

  describe("POST /api/auth/logout-all", () => {
    beforeEach(async () => {
      await app.get(UsersService).create(ada);
    });

    it("ends every session of the user", async () => {
      const phone = await loggedIn(ada);
      const laptop = await loggedIn(ada);
      const laptopRefreshToken = cookieValue(setCookies(laptop.login)["refresh_token"]);

      const response = await phone.agent.post("/api/auth/logout-all").expect(204);

      expect(setCookies(response)["refresh_token"]).toMatch(/^refresh_token=;/);
      await refreshWith(laptopRefreshToken).expect(401);
    });

    it("needs a logged-in user", async () => {
      const response = await browser().post("/api/auth/logout-all").expect(401);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("/api/auth/sessions", () => {
    beforeEach(async () => {
      await app.get(UsersService).create(ada);
      await app.get(UsersService).create(grace);
    });

    it("lists the user's own sessions and marks the one asking", async () => {
      const phone = await loggedIn(ada, "Phone");
      await loggedIn(ada, "Laptop");
      await loggedIn(grace, "Grace's laptop");

      const { items } = await sessionsOf(phone.agent);

      expect(items).toHaveLength(2);
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userAgent: "Phone", current: true }),
          expect.objectContaining({ userAgent: "Laptop", current: false }),
        ]),
      );
    });

    it("ends one of the user's sessions by its id", async () => {
      const phone = await loggedIn(ada, "Phone");
      const laptop = await loggedIn(ada, "Laptop");
      const laptopSession = (await sessionsOf(laptop.agent)).items.find((session) => session.current);

      await phone.agent.delete(`/api/auth/sessions/${laptopSession?.id ?? ""}`).expect(204);

      await refreshWith(cookieValue(setCookies(laptop.login)["refresh_token"])).expect(401);
      expect((await sessionsOf(phone.agent)).items).toHaveLength(1);
    });

    it("answers 404 NOT_FOUND for another user's session", async () => {
      const adas = await loggedIn(ada);
      const graces = await loggedIn(grace);
      const graceSession = (await sessionsOf(graces.agent)).items[0];

      const response = await adas.agent.delete(`/api/auth/sessions/${graceSession?.id ?? ""}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
      expect((await sessionsOf(graces.agent)).items).toHaveLength(1);
    });

    it("rejects an id that is not a UUID", async () => {
      const { agent } = await loggedIn(ada);

      const response = await agent.delete("/api/auth/sessions/not-a-uuid").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["id"]);
    });
  });
});
