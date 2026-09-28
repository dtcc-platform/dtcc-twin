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

describe("Users (e2e)", () => {
  let app: INestApplication<App>;
  // Every request goes out as an admin, who passes every role check; the guard has its own spec.
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
      .post("/api/users")
      .send({ password: "correct horse", ...body })
      .expect(201);
    return userSchema.parse(response.body);
  }

  describe("POST /api/users", () => {
    it("creates a user with a trimmed name and the user role", async () => {
      const user = await createUser({ email: "ada@example.com", name: "  Ada  " });

      expect(user).toMatchObject({ email: "ada@example.com", name: "Ada", role: "user" });
      expect(user.updatedAt).toBe(user.createdAt);
    });

    it("creates a user with the role the admin gives", async () => {
      const user = await createUser({ email: "grace@example.com", name: "Grace", role: "admin" });

      expect(user.role).toBe("admin");
    });

    it("stores an argon2id hash of the password and never returns it", async () => {
      const response = await admin
        .post("/api/users")
        .send({ email: "ada@example.com", name: "Ada", password: "correct horse" })
        .expect(201);

      expect(Object.keys(response.body as object)).not.toContain("passwordHash");
      const [row] = await query<{ password_hash: string }>("select password_hash from users");
      expect(row?.password_hash).toMatch(/^\$argon2id\$/);
    });

    it("rejects a missing password", async () => {
      const response = await admin.post("/api/users").send({ email: "ada@example.com", name: "Ada" }).expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["password"]);
    });

    it("rejects an email another user has, whatever its case, with a CONFLICT error", async () => {
      await createUser({ email: "ada@example.com", name: "Ada" });

      const response = await admin
        .post("/api/users")
        .send({ email: "ADA@example.com", name: "Impostor", password: "correct horse" })
        .expect(409);

      expect(errorResponseSchema.parse(response.body).error).toMatchObject({ status: 409, code: "CONFLICT" });
    });

    it("rejects an invalid email", async () => {
      const response = await admin
        .post("/api/users")
        .send({ email: "ada", name: "Ada", password: "correct horse" })
        .expect(400);

      const error = errorResponseSchema.parse(response.body).error;
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.errors?.map((issue) => issue.path)).toEqual(["email"]);
    });
  });

  describe("GET /api/users", () => {
    it("lists users in creation order and pages with limit and offset", async () => {
      await createUser({ email: "ada@example.com", name: "Ada" });
      await createUser({ email: "grace@example.com", name: "Grace" });

      const all = userPageSchema.parse((await admin.get("/api/users").expect(200)).body);
      expect(all).toMatchObject({ limit: 20, offset: 0, total: 2 });
      expect(all.items.map((user) => user.name)).toEqual(["Ada", "Grace"]);

      const second = userPageSchema.parse((await admin.get("/api/users?limit=1&offset=1").expect(200)).body);
      expect(second).toMatchObject({ limit: 1, offset: 1, total: 2 });
      expect(second.items.map((user) => user.name)).toEqual(["Grace"]);
    });
  });

  describe("GET /api/users/:id", () => {
    it("returns a user", async () => {
      const created = await createUser({ email: "ada@example.com", name: "Ada" });

      const response = await admin.get(`/api/users/${created.id}`).expect(200);

      expect(userSchema.parse(response.body)).toEqual(created);
    });

    it("returns a NOT_FOUND error for a missing user", async () => {
      const response = await admin.get(`/api/users/${missingId}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error).toMatchObject({ status: 404, code: "NOT_FOUND" });
    });

    it("rejects an id that is not a UUID", async () => {
      const response = await admin.get("/api/users/not-a-uuid").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["id"]);
    });
  });

  describe("PATCH /api/users/:id", () => {
    it("changes only the given fields and bumps updatedAt", async () => {
      const created = await createUser({ email: "ada@example.com", name: "Ada" });

      const response = await admin.patch(`/api/users/${created.id}`).send({ name: "Ada Lovelace" }).expect(200);

      const updated = userSchema.parse(response.body);
      expect(updated).toMatchObject({ id: created.id, email: "ada@example.com", name: "Ada Lovelace" });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("accepts an empty body and changes nothing, updatedAt included", async () => {
      const created = await createUser({ email: "ada@example.com", name: "Ada" });

      const response = await admin.patch(`/api/users/${created.id}`).send({}).expect(200);

      expect(userSchema.parse(response.body)).toEqual(created);
    });

    it("rejects taking another user's email with a CONFLICT error", async () => {
      await createUser({ email: "ada@example.com", name: "Ada" });
      const grace = await createUser({ email: "grace@example.com", name: "Grace" });

      const response = await admin.patch(`/api/users/${grace.id}`).send({ email: "ada@example.com" }).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
    });

    it("returns a NOT_FOUND error for a missing user", async () => {
      const response = await admin.patch(`/api/users/${missingId}`).send({ name: "Nobody" }).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });
  });

  describe("DELETE /api/users/:id", () => {
    it("deletes a user together with their settings and items", async () => {
      const user = await createUser({ email: "ada@example.com", name: "Ada" });
      const ada = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
      await ada.patch("/api/settings").send({ theme: "dark" }).expect(200);
      await ada.post("/api/items").send({ name: "Notebook" }).expect(201);

      const response = await admin.delete(`/api/users/${user.id}`).expect(204);

      expect(response.text).toBe("");
      await admin.get(`/api/users/${user.id}`).expect(404);
      const [left] = await query<{ items: number; settings: number }>(
        "select (select count(*)::int from items) as items, (select count(*)::int from settings) as settings",
      );
      expect(left).toEqual({ items: 0, settings: 0 });
    });

    it("returns a NOT_FOUND error for a missing user", async () => {
      const response = await admin.delete(`/api/users/${missingId}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
    });
  });

  describe("PATCH /api/users/me", () => {
    it("lets a user change their own name and email", async () => {
      const user = await createUser({ email: "ada@example.com", name: "Ada" });
      const ada = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));

      const response = await ada.patch("/api/users/me").send({ name: "Ada Lovelace" }).expect(200);

      expect(userSchema.parse(response.body)).toMatchObject({ id: user.id, name: "Ada Lovelace", role: "user" });
    });

    it("does not let a user change their own role", async () => {
      const user = await createUser({ email: "ada@example.com", name: "Ada" });
      const ada = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));

      const response = await ada.patch("/api/users/me").send({ role: "admin" }).expect(400);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("needs a logged-in user", async () => {
      const response = await request(app.getHttpServer()).patch("/api/users/me").send({ name: "Nobody" }).expect(401);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
    });
  });

  it("keeps the other users routes admin-only", async () => {
    const user = await authHeader("user");

    const response = await request(app.getHttpServer()).get("/api/users").set(user).expect(403);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("FORBIDDEN");
  });

  describe("UsersService.verifyCredentials", () => {
    it("returns the user for the right password, whatever the email's case", async () => {
      const created = await createUser({ email: "Ada@example.com", name: "Ada" });

      await expect(app.get(UsersService).verifyCredentials("ada@EXAMPLE.com", "correct horse")).resolves.toEqual(
        created,
      );
    });

    it("returns nothing for a wrong password", async () => {
      await createUser({ email: "ada@example.com", name: "Ada" });

      await expect(app.get(UsersService).verifyCredentials("ada@example.com", "wrong horse")).resolves.toBeUndefined();
    });

    it("returns nothing for an email no user has", async () => {
      await expect(
        app.get(UsersService).verifyCredentials("nobody@example.com", "correct horse"),
      ).resolves.toBeUndefined();
    });
  });
});
