import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, itemPageSchema, itemSchema, type Item } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsersService } from "../../src/modules/users/users.service.js";
import { authHeader } from "../helpers/auth.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { truncateAllTables } from "../helpers/database.js";

const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";

describe("Items (e2e)", () => {
  let app: INestApplication<App>;
  // Two logged-in users, so every route can show it never reaches the other one's items.
  let ada: Agent;
  let adaId: string;
  let grace: Agent;

  // One app per file: it holds no state, and the tables are emptied before each test.
  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    ({ agent: ada, userId: adaId } = await loggedIn("ada@example.com"));
    ({ agent: grace } = await loggedIn("grace@example.com"));
  });

  async function loggedIn(email: string): Promise<{ agent: Agent; userId: string }> {
    const user = await app.get(UsersService).create({ email, name: "Owner", password: "correct horse" });
    const agent = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
    return { agent, userId: user.id };
  }

  async function createItem(agent: Agent, body: Record<string, unknown>): Promise<Item> {
    const response = await agent.post("/api/items").send(body).expect(201);
    return itemSchema.parse(response.body);
  }

  it("needs a logged-in user", async () => {
    const response = await request(app.getHttpServer()).get("/api/items").expect(401);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });

  describe("POST /api/items", () => {
    it("creates an item owned by the user asking, with a trimmed name and a null description", async () => {
      const item = await createItem(ada, { name: "  Notebook  " });

      expect(item).toMatchObject({ userId: adaId, name: "Notebook", description: null });
      expect(item.updatedAt).toBe(item.createdAt);
    });

    it("rejects an invalid body with the path of each issue", async () => {
      const response = await ada.post("/api/items").send({ name: "", description: 42 }).expect(400);

      const error = errorResponseSchema.parse(response.body).error;
      expect(error).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
      expect(error.errors?.map((issue) => issue.path)).toEqual(["name", "description"]);
    });

    it("rejects an owner in the body, since the owner is whoever asks", async () => {
      const response = await ada.post("/api/items").send({ userId: adaId, name: "Notebook" }).expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.[0]?.message).toContain("userId");
    });
  });

  describe("GET /api/items", () => {
    it("lists only the user's own items, in creation order, paged with limit and offset", async () => {
      await createItem(ada, { name: "First" });
      await createItem(grace, { name: "Grace's" });
      await createItem(ada, { name: "Second" });

      const all = itemPageSchema.parse((await ada.get("/api/items").expect(200)).body);
      expect(all).toMatchObject({ limit: 20, offset: 0, total: 2 });
      expect(all.items.map((item) => item.name)).toEqual(["First", "Second"]);

      const second = itemPageSchema.parse((await ada.get("/api/items?limit=1&offset=1").expect(200)).body);
      expect(second).toMatchObject({ limit: 1, offset: 1, total: 2 });
      expect(second.items.map((item) => item.name)).toEqual(["Second"]);
    });

    it("rejects a limit above 100", async () => {
      const response = await ada.get("/api/items?limit=1000").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["limit"]);
    });
  });

  describe("GET /api/items/:id", () => {
    it("returns the user's item", async () => {
      const created = await createItem(ada, { name: "Notebook", description: "Blue" });

      const response = await ada.get(`/api/items/${created.id}`).expect(200);

      expect(itemSchema.parse(response.body)).toEqual(created);
    });

    it("answers NOT_FOUND for another user's item, as for one that does not exist", async () => {
      const graces = await createItem(grace, { name: "Grace's" });

      const other = await ada.get(`/api/items/${graces.id}`).expect(404);
      const missing = await ada.get(`/api/items/${missingId}`).expect(404);

      expect(errorResponseSchema.parse(other.body).error.code).toBe("NOT_FOUND");
      expect(errorResponseSchema.parse(missing.body).error.code).toBe("NOT_FOUND");
    });
  });

  describe("PATCH /api/items/:id", () => {
    it("changes only the given fields and bumps updatedAt", async () => {
      const created = await createItem(ada, { name: "Notebook", description: "Blue" });

      const response = await ada.patch(`/api/items/${created.id}`).send({ name: "Sketchbook" }).expect(200);

      const updated = itemSchema.parse(response.body);
      expect(updated).toMatchObject({ id: created.id, userId: adaId, name: "Sketchbook", description: "Blue" });
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("accepts an empty body and changes nothing, updatedAt included", async () => {
      const created = await createItem(ada, { name: "Notebook" });

      const response = await ada.patch(`/api/items/${created.id}`).send({}).expect(200);

      expect(itemSchema.parse(response.body)).toEqual(created);
    });

    it("clears the description with null", async () => {
      const created = await createItem(ada, { name: "Notebook", description: "Blue" });

      const response = await ada.patch(`/api/items/${created.id}`).send({ description: null }).expect(200);

      expect(itemSchema.parse(response.body).description).toBeNull();
    });

    it("answers NOT_FOUND for another user's item and leaves it as it was", async () => {
      const graces = await createItem(grace, { name: "Grace's" });

      const response = await ada.patch(`/api/items/${graces.id}`).send({ name: "Taken" }).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
      const unchanged = await grace.get(`/api/items/${graces.id}`).expect(200);
      expect(itemSchema.parse(unchanged.body)).toEqual(graces);
    });
  });

  describe("DELETE /api/items/:id", () => {
    it("deletes the user's item", async () => {
      const created = await createItem(ada, { name: "Notebook" });

      const response = await ada.delete(`/api/items/${created.id}`).expect(204);

      expect(response.text).toBe("");
      await ada.get(`/api/items/${created.id}`).expect(404);
    });

    it("answers NOT_FOUND for another user's item and leaves it in place", async () => {
      const graces = await createItem(grace, { name: "Grace's" });

      const response = await ada.delete(`/api/items/${graces.id}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
      await grace.get(`/api/items/${graces.id}`).expect(200);
    });
  });
});
