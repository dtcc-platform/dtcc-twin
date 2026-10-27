import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, userPageSchema, userSchema, type User } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsersService } from "../../src/modules/users/users.service.js";
import { authHeader } from "../helpers/auth.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { query, truncateAllTables } from "../helpers/database.js";

const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";
const password = "correct horse";

describe("Admin user routes (e2e)", () => {
  let app: INestApplication<App>;
  // Every request goes out as an admin with no row, who passes every role check and never counts as one of
  // the active admins below; the guard has its own spec.
  let admin: Agent;

  // One app per file: it holds no state, and the tables are emptied before each test.
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

  async function createUser(body: Record<string, unknown>): Promise<User> {
    const response = await admin
      .post("/api/admin/users")
      .send({ password: "correct horse", ...body })
      .expect(201);
    return userSchema.parse(response.body);
  }

  /** Signs up through the public route, as a new user does: pending, default tier, logged in. */
  async function registered(email: string): Promise<{ user: User; browser: Agent }> {
    const browser = request.agent(app.getHttpServer());
    const response = await browser.post("/api/auth/register").send({ email, name: "Someone", password }).expect(201);
    return { user: userSchema.parse(response.body), browser };
  }

  /** Created by an admin, so already active. */
  function activeUser(email: string, role: "user" | "admin" = "user"): Promise<User> {
    return app.get(UsersService).create({ email, name: "Someone", password, role });
  }

  async function sessionCount(userId: string): Promise<number> {
    const [row] = await query<{ count: number }>("select count(*)::int as count from sessions where user_id = $1", [
      userId,
    ]);
    return row?.count ?? 0;
  }

  function setStatus(id: string, status: string, as: Agent = admin) {
    return as.put(`/api/admin/users/${id}/status`).send({ status });
  }

  function setTier(id: string, tier: string, as: Agent = admin) {
    return as.put(`/api/admin/users/${id}/tier`).send({ tier });
  }

  describe("POST /api/admin/users", () => {
    it("creates a user with a trimmed name and the user role", async () => {
      const user = await createUser({ email: "ada@example.com", name: "  Ada  " });

      expect(user).toMatchObject({ email: "ada@example.com", name: "Ada", role: "user" });
      expect(user.updatedAt).toBe(user.createdAt);
    });

    it("creates an active user on the default tier, since an admin made them", async () => {
      const user = await createUser({ email: "ada@example.com", name: "Ada" });

      expect(user).toMatchObject({ status: "active", tier: "default" });
    });

    it("creates a user with the role the admin gives", async () => {
      const user = await createUser({ email: "grace@example.com", name: "Grace", role: "admin" });

      expect(user.role).toBe("admin");
    });

    it("stores an argon2id hash of the password and never returns it", async () => {
      const response = await admin
        .post("/api/admin/users")
        .send({ email: "ada@example.com", name: "Ada", password: "correct horse" })
        .expect(201);

      expect(Object.keys(response.body as object)).not.toContain("passwordHash");
      const [row] = await query<{ password_hash: string }>("select password_hash from users");
      expect(row?.password_hash).toMatch(/^\$argon2id\$/);
    });

    it("rejects a missing password", async () => {
      const response = await admin.post("/api/admin/users").send({ email: "ada@example.com", name: "Ada" }).expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["password"]);
    });

    it("rejects an email another user has, whatever its case, with a CONFLICT error", async () => {
      await createUser({ email: "ada@example.com", name: "Ada" });

      const response = await admin
        .post("/api/admin/users")
        .send({ email: "ADA@example.com", name: "Impostor", password: "correct horse" })
        .expect(409);

      expect(errorResponseSchema.parse(response.body).error).toMatchObject({ status: 409, code: "CONFLICT" });
    });

    it("rejects an invalid email", async () => {
      const response = await admin
        .post("/api/admin/users")
        .send({ email: "ada", name: "Ada", password: "correct horse" })
        .expect(400);

      const error = errorResponseSchema.parse(response.body).error;
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.errors?.map((issue) => issue.path)).toEqual(["email"]);
    });
  });

  describe("GET /api/admin/users", () => {
    it("lists users in creation order and pages with limit and offset", async () => {
      await createUser({ email: "ada@example.com", name: "Ada" });
      await createUser({ email: "grace@example.com", name: "Grace" });

      const all = userPageSchema.parse((await admin.get("/api/admin/users").expect(200)).body);
      expect(all).toMatchObject({ limit: 20, offset: 0, total: 2 });
      expect(all.items.map((user) => user.name)).toEqual(["Ada", "Grace"]);

      const second = userPageSchema.parse((await admin.get("/api/admin/users?limit=1&offset=1").expect(200)).body);
      expect(second).toMatchObject({ limit: 1, offset: 1, total: 2 });
      expect(second.items.map((user) => user.name)).toEqual(["Grace"]);
    });

    it("lists only the users with the given status, counting only them", async () => {
      await createUser({ email: "ada@example.com", name: "Ada" });
      await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({ email: "grace@example.com", name: "Grace", password: "correct horse" })
        .expect(201);

      const pending = userPageSchema.parse((await admin.get("/api/admin/users?status=pending").expect(200)).body);

      expect(pending.total).toBe(1);
      expect(pending.items.map((user) => user.name)).toEqual(["Grace"]);
    });

    it("rejects an unknown status filter", async () => {
      const response = await admin.get("/api/admin/users?status=banned").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["status"]);
    });
  });

  describe("GET /api/admin/users/:id", () => {
    it("returns a user", async () => {
      const created = await createUser({ email: "ada@example.com", name: "Ada" });

      const response = await admin.get(`/api/admin/users/${created.id}`).expect(200);

      expect(userSchema.parse(response.body)).toEqual(created);
    });

    it("returns a NOT_FOUND error for a missing user", async () => {
      const response = await admin.get(`/api/admin/users/${missingId}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error).toMatchObject({ status: 404, code: "NOT_FOUND" });
    });

    it("rejects an id that is not a UUID", async () => {
      const response = await admin.get("/api/admin/users/not-a-uuid").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["id"]);
    });
  });

  describe("PATCH /api/admin/users/:id", () => {
    it("changes only the given fields and bumps updatedAt", async () => {
      const created = await createUser({ email: "ada@example.com", name: "Ada" });

      const response = await admin.patch(`/api/admin/users/${created.id}`).send({ name: "Ada Lovelace" }).expect(200);

      const updated = userSchema.parse(response.body);
      expect(updated).toMatchObject({ id: created.id, email: "ada@example.com", name: "Ada Lovelace" });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("accepts an empty body and changes nothing, updatedAt included", async () => {
      const created = await createUser({ email: "ada@example.com", name: "Ada" });

      const response = await admin.patch(`/api/admin/users/${created.id}`).send({}).expect(200);

      expect(userSchema.parse(response.body)).toEqual(created);
    });

    it("rejects taking another user's email with a CONFLICT error", async () => {
      await createUser({ email: "ada@example.com", name: "Ada" });
      const grace = await createUser({ email: "grace@example.com", name: "Grace" });

      const response = await admin.patch(`/api/admin/users/${grace.id}`).send({ email: "ada@example.com" }).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
    });

    it("returns a NOT_FOUND error for a missing user", async () => {
      const response = await admin.patch(`/api/admin/users/${missingId}`).send({ name: "Nobody" }).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });

    it("leaves status and tier to their own routes", async () => {
      const created = await createUser({ email: "ada@example.com", name: "Ada" });

      const status = await admin.patch(`/api/admin/users/${created.id}`).send({ status: "disabled" }).expect(400);
      const tier = await admin.patch(`/api/admin/users/${created.id}`).send({ tier: "elevated" }).expect(400);

      expect(errorResponseSchema.parse(status.body).error.code).toBe("VALIDATION_FAILED");
      expect(errorResponseSchema.parse(tier.body).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("DELETE /api/admin/users/:id", () => {
    it("deletes a user together with their settings and items", async () => {
      const user = await createUser({ email: "ada@example.com", name: "Ada" });
      const ada = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
      await ada.patch("/api/settings").send({ theme: "dark" }).expect(200);
      await ada.post("/api/items").send({ name: "Notebook" }).expect(201);

      const response = await admin.delete(`/api/admin/users/${user.id}`).expect(204);

      expect(response.text).toBe("");
      await admin.get(`/api/admin/users/${user.id}`).expect(404);
      const [left] = await query<{ items: number; settings: number }>(
        "select (select count(*)::int from items) as items, (select count(*)::int from settings) as settings",
      );
      expect(left).toEqual({ items: 0, settings: 0 });
    });

    it("returns a NOT_FOUND error for a missing user", async () => {
      const response = await admin.delete(`/api/admin/users/${missingId}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });

    it("refuses to let an admin delete themselves", async () => {
      const me = await createUser({ email: "root@example.com", name: "Root", role: "admin" });
      await createUser({ email: "other-admin@example.com", name: "Other", role: "admin" });
      const self = request.agent(app.getHttpServer()).set(await authHeader("admin", { userId: me.id }));

      const response = await self.delete(`/api/admin/users/${me.id}`).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
    });

    it("refuses to delete the last active admin", async () => {
      const onlyAdmin = await createUser({ email: "root@example.com", name: "Root", role: "admin" });

      const response = await admin.delete(`/api/admin/users/${onlyAdmin.id}`).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
      await admin.get(`/api/admin/users/${onlyAdmin.id}`).expect(200);
    });
  });

  describe("PUT /api/admin/users/:id/status", () => {
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
      const user = await activeUser("ada@example.com");
      await setStatus(user.id, "disabled").expect(200);

      const response = await setStatus(user.id, "active").expect(200);

      expect(userSchema.parse(response.body).status).toBe("active");
    });

    it("changes nothing when the user already has the status, updatedAt included", async () => {
      const user = await activeUser("ada@example.com");

      const response = await setStatus(user.id, "active").expect(200);

      expect(userSchema.parse(response.body)).toEqual(user);
    });

    it("ends the sessions of a user who is already disabled, so a retry finishes the job", async () => {
      const user = await activeUser("ada@example.com");
      await request(app.getHttpServer()).post("/api/auth/login").send({ email: user.email, password }).expect(200);
      await query("update users set status = 'disabled' where id = $1", [user.id]);

      await setStatus(user.id, "disabled").expect(200);

      expect(await sessionCount(user.id)).toBe(0);
    });

    it("never sets a user back to pending", async () => {
      const user = await activeUser("ada@example.com");

      const response = await setStatus(user.id, "pending").expect(400);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("refuses to let an admin change their own status", async () => {
      const me = await activeUser("root@example.com", "admin");
      await activeUser("other-admin@example.com", "admin");
      const self = request.agent(app.getHttpServer()).set(await authHeader("admin", { userId: me.id }));

      const response = await setStatus(me.id, "disabled", self).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
    });

    it("refuses to disable the last active admin", async () => {
      const onlyAdmin = await activeUser("root@example.com", "admin");

      const response = await setStatus(onlyAdmin.id, "disabled").expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
      expect((await app.get(UsersService).get(onlyAdmin.id)).status).toBe("active");
    });

    it("disables an admin while another admin stays active", async () => {
      const first = await activeUser("root@example.com", "admin");
      await activeUser("other-admin@example.com", "admin");

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

  describe("PUT /api/admin/users/:id/tier", () => {
    it("moves a user to another tier, whatever their status", async () => {
      const { user } = await registered("ada@example.com");

      const response = await setTier(user.id, "elevated").expect(200);

      expect(userSchema.parse(response.body)).toMatchObject({ id: user.id, status: "pending", tier: "elevated" });
    });

    it("keeps the tier through disable and enable", async () => {
      const user = await activeUser("ada@example.com");
      await setTier(user.id, "elevated").expect(200);

      await setStatus(user.id, "disabled").expect(200);
      const response = await setStatus(user.id, "active").expect(200);

      expect(userSchema.parse(response.body).tier).toBe("elevated");
    });

    it("changes nothing when the user already has the tier, updatedAt included", async () => {
      const user = await activeUser("ada@example.com");

      const response = await setTier(user.id, "default").expect(200);

      expect(userSchema.parse(response.body)).toEqual(user);
    });

    it("rejects an unknown tier", async () => {
      const user = await activeUser("ada@example.com");

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
  it("keeps the other users routes admin-only", async () => {
    const user = await authHeader("user");

    const response = await request(app.getHttpServer()).get("/api/admin/users").set(user).expect(403);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("FORBIDDEN");
  });
});
