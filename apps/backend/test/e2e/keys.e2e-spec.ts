import { Logger, type INestApplication } from "@nestjs/common";
import { apiKeyListSchema, createdApiKeySchema, errorResponseSchema, type CreatedApiKey } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startStubGateway } from "../helpers/stub-gateway.js";

// ConfigModule reads the environment when app.module.ts is imported, so the stub must be listening before that.
const gateway = await startStubGateway();
vi.stubEnv("APISIX_ADMIN_URL", gateway.url);
vi.stubEnv("APISIX_ADMIN_KEY", gateway.adminKey);
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { truncateAllTables } = await import("../helpers/database.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");

const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";
const password = "correct horse";

describe("API keys (e2e)", () => {
  let app: INestApplication<App>;
  // Two active users, so every route can show it never reaches the other one's keys.
  let ada: Agent;
  let adaId: string;
  let grace: Agent;
  let graceId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await gateway.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await truncateAllTables();
    gateway.reset();
    ({ agent: ada, userId: adaId } = await loggedIn("ada@example.com"));
    ({ agent: grace, userId: graceId } = await loggedIn("grace@example.com"));
  });

  /** Created by an admin, so already active. */
  async function loggedIn(email: string): Promise<{ agent: Agent; userId: string }> {
    const user = await app.get(UsersService).create({ email, name: "Owner", password });
    return { agent: await agentFor(user.id), userId: user.id };
  }

  async function agentFor(userId: string): Promise<Agent> {
    return request.agent(app.getHttpServer()).set(await authHeader("user", { userId }));
  }

  // An admin with no row, who passes every role check.
  async function adminAgent(): Promise<Agent> {
    return request.agent(app.getHttpServer()).set(await authHeader("admin"));
  }

  async function create(agent: Agent, body: Record<string, unknown> = { name: "Laptop" }): Promise<CreatedApiKey> {
    const response = await agent.post("/api/keys").send(body).expect(201);
    return createdApiKeySchema.parse(response.body);
  }

  async function names(agent: Agent): Promise<string[]> {
    const response = await agent.get("/api/keys").expect(200);
    return apiKeyListSchema.parse(response.body).items.map((key) => key.name);
  }

  function quietLogs(): void {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  }

  describe("POST /api/keys", () => {
    it("creates a key, shows it once, and registers it with the gateway under the user's consumer", async () => {
      const created = await create(ada, { name: "  Laptop  ", description: "For scripts" });

      expect(created).toMatchObject({ userId: adaId, name: "Laptop", description: "For scripts" });
      expect(created.key).toMatch(/^dtcc_[A-Za-z0-9_-]{43}$/);
      expect(created.key.startsWith(created.prefix)).toBe(true);
      expect(created.prefix.length).toBeLessThan(created.key.length);
      expect(gateway.credentials(adaId)).toEqual({ [created.id]: created.key });
    });

    it("never returns the key again", async () => {
      const created = await create(ada);

      const response = await ada.get("/api/keys").expect(200);

      expect(JSON.stringify(response.body)).not.toContain(created.key);
      expect(apiKeyListSchema.parse(response.body).items).toEqual([
        {
          id: created.id,
          userId: adaId,
          name: "Laptop",
          description: null,
          prefix: created.prefix,
          createdAt: created.createdAt,
        },
      ]);
    });

    it("makes a different key every time", async () => {
      const first = await create(ada);
      const second = await create(ada);

      expect(second.key).not.toBe(first.key);
      expect(Object.keys(gateway.credentials(adaId) ?? {})).toHaveLength(2);
    });

    it("refuses a sixth key with a CONFLICT error", async () => {
      for (let count = 0; count < 5; count++) await create(ada, { name: `Key ${String(count)}` });

      const response = await ada.post("/api/keys").send({ name: "One too many" }).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
      expect(await names(ada)).toHaveLength(5);
      expect(Object.keys(gateway.credentials(adaId) ?? {})).toHaveLength(5);
    });

    it("refuses pending and disabled accounts with a FORBIDDEN error, registering nothing", async () => {
      const users = app.get(UsersService);
      const pending = await users.register({ email: "katherine@example.com", name: "Katherine", password });
      const disabled = await users.create({ email: "charles@example.com", name: "Charles", password });
      await users.setStatus(disabled.id, "disabled");

      for (const userId of [pending.id, disabled.id]) {
        const response = await (await agentFor(userId)).post("/api/keys").send({ name: "Laptop" }).expect(403);
        expect(errorResponseSchema.parse(response.body).error.code).toBe("FORBIDDEN");
      }
      expect(gateway.consumers()).toEqual([]);
    });

    it("answers SERVICE_UNAVAILABLE and keeps no key when the gateway fails", async () => {
      quietLogs();
      gateway.setFailing(true);

      const response = await ada.post("/api/keys").send({ name: "Laptop" }).expect(503);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("SERVICE_UNAVAILABLE");
      expect(await names(ada)).toEqual([]);
    });

    it("answers SERVICE_UNAVAILABLE and keeps no key when the gateway is unreachable", async () => {
      quietLogs();
      gateway.setReachable(false);

      await ada.post("/api/keys").send({ name: "Laptop" }).expect(503);

      gateway.setReachable(true);
      expect(await names(ada)).toEqual([]);
      expect(gateway.consumers()).toEqual([]);
    });

    it("rejects a blank name and unknown fields", async () => {
      const blank = await ada.post("/api/keys").send({ name: "  " }).expect(400);
      const key = await ada.post("/api/keys").send({ name: "Laptop", key: "dtcc_mine" }).expect(400);

      expect(errorResponseSchema.parse(blank.body).error.errors?.map((issue) => issue.path)).toEqual(["name"]);
      expect(errorResponseSchema.parse(key.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("needs a login", async () => {
      const response = await request(app.getHttpServer()).post("/api/keys").send({ name: "Laptop" }).expect(401);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("GET /api/keys", () => {
    it("lists the caller's keys in creation order, never another user's", async () => {
      await create(ada, { name: "Laptop" });
      await create(grace, { name: "Grace's server" });
      await create(ada, { name: "CI" });

      expect(await names(ada)).toEqual(["Laptop", "CI"]);
      expect(await names(grace)).toEqual(["Grace's server"]);
    });

    it("lists no keys for a pending user", async () => {
      const pending = await app.get(UsersService).register({ email: "k@example.com", name: "K", password });

      expect(await names(await agentFor(pending.id))).toEqual([]);
    });

    it("needs a login", async () => {
      await request(app.getHttpServer()).get("/api/keys").expect(401);
    });
  });

  describe("DELETE /api/keys/:id", () => {
    it("deletes the key from the gateway and the list, keeping the user's other keys", async () => {
      const laptop = await create(ada, { name: "Laptop" });
      const ci = await create(ada, { name: "CI" });

      const response = await ada.delete(`/api/keys/${laptop.id}`).expect(204);

      expect(response.text).toBe("");
      expect(await names(ada)).toEqual(["CI"]);
      expect(gateway.credentials(adaId)).toEqual({ [ci.id]: ci.key });
    });

    it("deletes a key the gateway has already lost", async () => {
      const laptop = await create(ada);
      gateway.reset();

      await ada.delete(`/api/keys/${laptop.id}`).expect(204);

      expect(await names(ada)).toEqual([]);
    });

    it("keeps the key, listed and working, when the gateway fails", async () => {
      quietLogs();
      const laptop = await create(ada);
      gateway.setFailing(true);

      const response = await ada.delete(`/api/keys/${laptop.id}`).expect(503);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("SERVICE_UNAVAILABLE");
      gateway.setFailing(false);
      expect(await names(ada)).toEqual(["Laptop"]);
      expect(gateway.credentials(adaId)).toEqual({ [laptop.id]: laptop.key });
    });

    it("returns a NOT_FOUND error for another user's key, which stays", async () => {
      const gracesKey = await create(grace);

      const response = await ada.delete(`/api/keys/${gracesKey.id}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
      expect(gateway.credentials(graceId)).toEqual({ [gracesKey.id]: gracesKey.key });
    });

    it("returns a NOT_FOUND error for a missing key and rejects an id that is not a UUID", async () => {
      await ada.delete(`/api/keys/${missingId}`).expect(404);
      const response = await ada.delete("/api/keys/not-a-uuid").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["id"]);
    });

    it("needs a login", async () => {
      await request(app.getHttpServer()).delete(`/api/keys/${missingId}`).expect(401);
    });
  });

  describe("GET /api/admin/users/:id/keys", () => {
    it("lists a user's keys for an admin", async () => {
      await create(ada, { name: "Laptop" });
      await create(grace, { name: "Grace's server" });

      const response = await (await adminAgent()).get(`/api/admin/users/${adaId}/keys`).expect(200);

      expect(apiKeyListSchema.parse(response.body).items.map((key) => key.name)).toEqual(["Laptop"]);
    });

    it("returns a NOT_FOUND error for a missing user and rejects an id that is not a UUID", async () => {
      const admin = await adminAgent();

      const missing = await admin.get(`/api/admin/users/${missingId}/keys`).expect(404);
      const invalid = await admin.get("/api/admin/users/not-a-uuid/keys").expect(400);

      expect(errorResponseSchema.parse(missing.body).error.code).toBe("NOT_FOUND");
      expect(errorResponseSchema.parse(invalid.body).error.errors?.map((issue) => issue.path)).toEqual(["id"]);
    });

    it("is admin-only", async () => {
      const asUser = await ada.get(`/api/admin/users/${graceId}/keys`).expect(403);
      await request(app.getHttpServer()).get(`/api/admin/users/${graceId}/keys`).expect(401);

      expect(errorResponseSchema.parse(asUser.body).error.code).toBe("FORBIDDEN");
    });
  });

  describe("DELETE /api/admin/users/:id/keys/:keyId", () => {
    it("revokes a user's key in the gateway and the list", async () => {
      const laptop = await create(ada, { name: "Laptop" });
      const ci = await create(ada, { name: "CI" });

      await (await adminAgent()).delete(`/api/admin/users/${adaId}/keys/${laptop.id}`).expect(204);

      expect(await names(ada)).toEqual(["CI"]);
      expect(gateway.credentials(adaId)).toEqual({ [ci.id]: ci.key });
    });

    it("returns a NOT_FOUND error for a key of another user, which stays", async () => {
      const gracesKey = await create(grace);

      const response = await (await adminAgent()).delete(`/api/admin/users/${adaId}/keys/${gracesKey.id}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
      expect(await names(grace)).toEqual(["Laptop"]);
    });

    it("keeps the key when the gateway fails", async () => {
      quietLogs();
      const laptop = await create(ada);
      gateway.setFailing(true);

      await (await adminAgent()).delete(`/api/admin/users/${adaId}/keys/${laptop.id}`).expect(503);

      expect(await names(ada)).toEqual(["Laptop"]);
    });

    it("rejects a key id that is not a UUID", async () => {
      const response = await (await adminAgent()).delete(`/api/admin/users/${adaId}/keys/not-a-uuid`).expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["keyId"]);
    });

    it("is admin-only", async () => {
      const gracesKey = await create(grace);

      await ada.delete(`/api/admin/users/${graceId}/keys/${gracesKey.id}`).expect(403);
      await request(app.getHttpServer()).delete(`/api/admin/users/${graceId}/keys/${gracesKey.id}`).expect(401);

      expect(await names(grace)).toEqual(["Laptop"]);
    });
  });

  describe("disabling and deleting a user", () => {
    function setStatus(admin: Agent, id: string, status: string) {
      return admin.put(`/api/admin/users/${id}/status`).send({ status });
    }

    it("disables a user by deleting their consumer, so every key stops at once, and lists none", async () => {
      await create(ada, { name: "Laptop" });
      await create(ada, { name: "CI" });
      const gracesKey = await create(grace);

      await setStatus(await adminAgent(), adaId, "disabled").expect(200);

      expect(gateway.consumers()).toEqual([graceId]);
      expect(gateway.credentials(graceId)).toEqual({ [gracesKey.id]: gracesKey.key });
      expect(await names(ada)).toEqual([]);
    });

    it("enables a user again with no keys, who can then create new ones", async () => {
      await create(ada);
      const admin = await adminAgent();
      await setStatus(admin, adaId, "disabled").expect(200);

      await setStatus(admin, adaId, "active").expect(200);

      expect(await names(ada)).toEqual([]);
      const created = await create(ada, { name: "New laptop" });
      expect(gateway.credentials(adaId)).toEqual({ [created.id]: created.key });
    });

    it("leaves the user active with every key when the gateway fails, and a retry finishes the job", async () => {
      quietLogs();
      const laptop = await create(ada);
      const admin = await adminAgent();
      gateway.setFailing(true);

      const response = await setStatus(admin, adaId, "disabled").expect(503);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("SERVICE_UNAVAILABLE");
      expect((await app.get(UsersService).get(adaId)).status).toBe("active");
      gateway.setFailing(false);
      expect(gateway.credentials(adaId)).toEqual({ [laptop.id]: laptop.key });
      expect(await names(ada)).toEqual(["Laptop"]);

      await setStatus(admin, adaId, "disabled").expect(200);
      expect(gateway.consumers()).toEqual([]);
    });

    it("disables a user without keys without calling the gateway", async () => {
      gateway.setFailing(true);

      await setStatus(await adminAgent(), adaId, "disabled").expect(200);

      expect((await app.get(UsersService).get(adaId)).status).toBe("disabled");
    });

    it("deletes a user's consumer before the user", async () => {
      await create(ada);

      await (await adminAgent()).delete(`/api/admin/users/${adaId}`).expect(204);

      expect(gateway.consumers()).toEqual([]);
    });

    it("keeps the user and their keys when the gateway fails during a delete", async () => {
      quietLogs();
      const laptop = await create(ada);
      gateway.setFailing(true);

      await (await adminAgent()).delete(`/api/admin/users/${adaId}`).expect(503);

      gateway.setFailing(false);
      expect(await names(ada)).toEqual(["Laptop"]);
      expect(gateway.credentials(adaId)).toEqual({ [laptop.id]: laptop.key });
    });
  });
});
