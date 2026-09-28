import { NotFoundException, type INestApplication } from "@nestjs/common";
import type { User } from "@repo/contracts";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import { AccessTokens } from "../../src/modules/auth/tokens/access-tokens.js";
import { UsersService } from "../../src/modules/users/users.service.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { query, truncateAllTables } from "../helpers/database.js";

describe("AuthService (e2e)", () => {
  let app: INestApplication<App>;
  let auth: AuthService;
  let accessTokens: AccessTokens;
  let users: UsersService;
  let ada: User;

  beforeAll(async () => {
    app = await createTestApp();
    auth = app.get(AuthService);
    accessTokens = app.get(AccessTokens);
    users = app.get(UsersService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    ada = await users.create({ email: "ada@example.com", name: "Ada", password: "correct horse" });
  });

  async function sessionCount(userId: string): Promise<number> {
    const [row] = await query<{ count: number }>("select count(*)::int as count from sessions where user_id = $1", [
      userId,
    ]);
    return row?.count ?? 0;
  }

  async function expireAllSessions(): Promise<void> {
    await query("update sessions set expires_at = now() - interval '1 second'");
  }

  describe("issue", () => {
    it("returns an access token for the user and a new session", async () => {
      const { accessToken } = await auth.issue(ada);

      const [session] = await query<{ id: string }>("select id from sessions");
      expect(await accessTokens.verify(accessToken)).toEqual({
        userId: ada.id,
        sessionId: session?.id,
        role: "user",
      });
    });

    it("stores a hash of the refresh token, never the token itself", async () => {
      const { refreshToken } = await auth.issue(ada);

      const [session] = await query<{ refresh_token_hash: string }>("select refresh_token_hash from sessions");
      expect(session?.refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(session?.refresh_token_hash).not.toContain(refreshToken);
    });

    it("clears the user's expired sessions", async () => {
      await auth.issue(ada);
      await expireAllSessions();

      await auth.issue(ada);

      expect(await sessionCount(ada.id)).toBe(1);
    });
  });

  describe("refresh", () => {
    it("returns a new access token for the same session and keeps the refresh token working", async () => {
      const issued = await auth.issue(ada);

      const refreshed = await auth.refresh(issued.refreshToken);

      expect(refreshed?.refreshToken).toBe(issued.refreshToken);
      expect(await accessTokens.verify(refreshed?.accessToken ?? "")).toEqual(
        await accessTokens.verify(issued.accessToken),
      );
      expect(await auth.refresh(issued.refreshToken)).toBeDefined();
    });

    it("extends the session to 30 days from the refresh, so an active user stays logged in", async () => {
      const { refreshToken } = await auth.issue(ada);
      await query("update sessions set expires_at = now() + interval '1 day'");

      await auth.refresh(refreshToken);

      const [session] = await query<{ days: number }>(
        "select extract(day from expires_at - now())::int as days from sessions",
      );
      expect(session?.days).toBe(29);
    });

    it("rejects an expired refresh token", async () => {
      const { refreshToken } = await auth.issue(ada);
      await expireAllSessions();

      expect(await auth.refresh(refreshToken)).toBeUndefined();
    });

    it("rejects a refresh token it never issued", async () => {
      expect(await auth.refresh("made-up")).toBeUndefined();
    });

    it("puts the user's current role in the new access token", async () => {
      const { refreshToken } = await auth.issue(ada);
      await query("update users set role = 'admin' where id = $1", [ada.id]);

      const refreshed = await auth.refresh(refreshToken);

      expect(await accessTokens.verify(refreshed?.accessToken ?? "")).toMatchObject({ role: "admin" });
    });
  });

  describe("revokeSession", () => {
    it("ends one session of the user and leaves the others", async () => {
      const phone = await auth.issue(ada);
      const laptop = await auth.issue(ada);
      const phoneSession = await accessTokens.verify(phone.accessToken);

      await auth.revokeSession(ada.id, phoneSession?.sessionId ?? "");

      expect(await auth.refresh(phone.refreshToken)).toBeUndefined();
      expect(await auth.refresh(laptop.refreshToken)).toBeDefined();
    });

    it("does not end another user's session", async () => {
      const grace = await users.create({ email: "grace@example.com", name: "Grace", password: "correct horse" });
      const graces = await auth.issue(grace);
      const graceSession = await accessTokens.verify(graces.accessToken);

      await expect(auth.revokeSession(ada.id, graceSession?.sessionId ?? "")).rejects.toThrow(NotFoundException);

      expect(await auth.refresh(graces.refreshToken)).toBeDefined();
    });
  });

  describe("logoutAll", () => {
    it("ends every session of the user", async () => {
      const phone = await auth.issue(ada);
      const laptop = await auth.issue(ada);

      await auth.logoutAll(ada.id);

      expect(await auth.refresh(phone.refreshToken)).toBeUndefined();
      expect(await auth.refresh(laptop.refreshToken)).toBeUndefined();
    });
  });

  it("deletes a user's sessions along with the user", async () => {
    await auth.issue(ada);

    await users.remove(ada.id);

    expect(await sessionCount(ada.id)).toBe(0);
  });
});
