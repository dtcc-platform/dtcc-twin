import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, userSchema, type User } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsersService } from "../../src/modules/users/users.service.js";
import { authHeader } from "../helpers/auth.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { query, truncateAllTables } from "../helpers/database.js";

const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";
const password = "correct horse";

describe("Account status and tier (e2e)", () => {
  let app: INestApplication<App>;
  // A made-up admin with no row, so they never count as one of the active admins below.
  let admin: Agent;

  beforeAll(async () => {
    app = await createTestApp();
    admin = request.agent(app.getHttpServer()).set(await authHeader("admin"));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  /** Signs up through the public route, as a new user does: pending, default tier, logged in. */
  async function registered(email: string): Promise<{ user: User; browser: Agent }> {
    const browser = request.agent(app.getHttpServer());
    const response = await browser.post("/api/auth/register").send({ email, name: "Someone", password }).expect(201);
    return { user: userSchema.parse(response.body), browser };
  }

  /** Created by an admin, so already active. */
  function created(email: string, role: "user" | "admin" = "user"): Promise<User> {
    return app.get(UsersService).create({ email, name: "Someone", password, role });
  }

  async function sessionCount(userId: string): Promise<number> {
    const [row] = await query<{ count: number }>("select count(*)::int as count from sessions where user_id = $1", [
      userId,
    ]);
    return row?.count ?? 0;
  }

  function setStatus(id: string, status: string, as: Agent = admin) {
    return as.put(`/api/users/${id}/status`).send({ status });
  }

  function setTier(id: string, tier: string, as: Agent = admin) {
    return as.put(`/api/users/${id}/tier`).send({ tier });
  }

  describe("PUT /api/users/:id/status", () => {
    it("approves a pending user", async () => {
      const { user } = await registered("ada@example.com");

      const response = await setStatus(user.id, "active").expect(200);

      const approved = userSchema.parse(response.body);
      expect(approved).toMatchObject({ id: user.id, status: "active", tier: "default" });
      expect(Date.parse(approved.updatedAt)).toBeGreaterThan(Date.parse(user.updatedAt));
    });

    it("rejects a pending user by disabling them", async () => {
      const { user } = await registered("ada@example.com");

      const response = await setStatus(user.id, "disabled").expect(200);

      expect(userSchema.parse(response.body).status).toBe("disabled");
    });

    it("disables an active user and ends every one of their sessions", async () => {
      const { user, browser } = await registered("ada@example.com");
      await setStatus(user.id, "active").expect(200);
      expect(await sessionCount(user.id)).toBe(1);

      await setStatus(user.id, "disabled").expect(200);

      expect(await sessionCount(user.id)).toBe(0);
      await browser.post("/api/auth/refresh").expect(401);
    });

    it("enables a disabled user again", async () => {
      const user = await created("ada@example.com");
      await setStatus(user.id, "disabled").expect(200);

      const response = await setStatus(user.id, "active").expect(200);

      expect(userSchema.parse(response.body).status).toBe("active");
    });

    it("changes nothing when the user already has the status, updatedAt included", async () => {
      const user = await created("ada@example.com");

      const response = await setStatus(user.id, "active").expect(200);

      expect(userSchema.parse(response.body)).toEqual(user);
    });

    it("ends the sessions of a user who is already disabled, so a retry finishes the job", async () => {
      const user = await created("ada@example.com");
      await request(app.getHttpServer()).post("/api/auth/login").send({ email: user.email, password }).expect(200);
      await query("update users set status = 'disabled' where id = $1", [user.id]);

      await setStatus(user.id, "disabled").expect(200);

      expect(await sessionCount(user.id)).toBe(0);
    });

    it("never sets a user back to pending", async () => {
      const user = await created("ada@example.com");

      const response = await setStatus(user.id, "pending").expect(400);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("refuses to let an admin change their own status", async () => {
      const me = await created("root@example.com", "admin");
      await created("other-admin@example.com", "admin");
      const self = request.agent(app.getHttpServer()).set(await authHeader("admin", { userId: me.id }));

      const response = await setStatus(me.id, "disabled", self).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
    });

    it("refuses to disable the last active admin", async () => {
      const onlyAdmin = await created("root@example.com", "admin");

      const response = await setStatus(onlyAdmin.id, "disabled").expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
      expect((await app.get(UsersService).get(onlyAdmin.id)).status).toBe("active");
    });

    it("disables an admin while another admin stays active", async () => {
      const first = await created("root@example.com", "admin");
      await created("other-admin@example.com", "admin");

      const response = await setStatus(first.id, "disabled").expect(200);

      expect(userSchema.parse(response.body).status).toBe("disabled");
    });

    it("returns a NOT_FOUND error for a missing user", async () => {
      const response = await setStatus(missingId, "active").expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });

    it("rejects an id that is not a UUID", async () => {
      const response = await setStatus("not-a-uuid", "active").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["id"]);
    });

    it("is admin-only", async () => {
      const { user, browser } = await registered("ada@example.com");

      const asUser = await setStatus(user.id, "active", browser).expect(403);
      const anonymous = await setStatus(user.id, "active", request.agent(app.getHttpServer())).expect(401);

      expect(errorResponseSchema.parse(asUser.body).error.code).toBe("FORBIDDEN");
      expect(errorResponseSchema.parse(anonymous.body).error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("PUT /api/users/:id/tier", () => {
    it("moves a user to another tier, whatever their status", async () => {
      const { user } = await registered("ada@example.com");

      const response = await setTier(user.id, "elevated").expect(200);

      expect(userSchema.parse(response.body)).toMatchObject({ id: user.id, status: "pending", tier: "elevated" });
    });

    it("keeps the tier through disable and enable", async () => {
      const user = await created("ada@example.com");
      await setTier(user.id, "elevated").expect(200);

      await setStatus(user.id, "disabled").expect(200);
      const response = await setStatus(user.id, "active").expect(200);

      expect(userSchema.parse(response.body).tier).toBe("elevated");
    });

    it("changes nothing when the user already has the tier, updatedAt included", async () => {
      const user = await created("ada@example.com");

      const response = await setTier(user.id, "default").expect(200);

      expect(userSchema.parse(response.body)).toEqual(user);
    });

    it("rejects an unknown tier", async () => {
      const user = await created("ada@example.com");

      const response = await setTier(user.id, "gold").expect(400);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("returns a NOT_FOUND error for a missing user", async () => {
      const response = await setTier(missingId, "elevated").expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });

    it("is admin-only", async () => {
      const { user, browser } = await registered("ada@example.com");

      const asUser = await setTier(user.id, "elevated", browser).expect(403);
      const anonymous = await setTier(user.id, "elevated", request.agent(app.getHttpServer())).expect(401);

      expect(errorResponseSchema.parse(asUser.body).error.code).toBe("FORBIDDEN");
      expect(errorResponseSchema.parse(anonymous.body).error.code).toBe("UNAUTHORIZED");
    });
  });
});
