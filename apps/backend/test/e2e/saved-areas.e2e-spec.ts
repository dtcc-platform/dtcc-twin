import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, savedAreaPageSchema, savedAreaSchema, type SavedArea } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsersService } from "../../src/modules/users/users.service.js";
import { authHeader } from "../helpers/auth.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { truncateAllTables } from "../helpers/database.js";

const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";
const chalmers = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };

describe("Saved areas (e2e)", () => {
  let app: INestApplication<App>;
  // Two logged-in users, so every route can show it never reaches the other one's areas.
  let ada: Agent;
  let grace: Agent;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    ada = await loggedIn("ada@example.com");
    grace = await loggedIn("grace@example.com");
  });

  async function loggedIn(email: string): Promise<Agent> {
    const user = await app.get(UsersService).create({ email, name: "Owner", password: "correct horse" });
    return request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
  }

  async function save(agent: Agent, name: string): Promise<SavedArea> {
    const response = await agent.post("/api/saved-areas").send({ name, area: chalmers }).expect(201);
    return savedAreaSchema.parse(response.body);
  }

  it("needs a logged-in user", async () => {
    const response = await request(app.getHttpServer()).get("/api/saved-areas").expect(401);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });

  describe("POST /api/saved-areas", () => {
    it("saves the area under a trimmed name", async () => {
      const response = await ada.post("/api/saved-areas").send({ name: "  Chalmers  ", area: chalmers }).expect(201);

      const saved = savedAreaSchema.parse(response.body);
      expect(saved).toMatchObject({ name: "Chalmers", area: chalmers });
      expect(saved.updatedAt).toBe(saved.createdAt);
    });

    it("rejects an invalid body with the path of each issue", async () => {
      const response = await ada
        .post("/api/saved-areas")
        .send({ name: "", area: { ...chalmers, east: 11.9 } })
        .expect(400);

      const error = errorResponseSchema.parse(response.body).error;
      expect(error).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
      expect(error.errors?.map((issue) => issue.path)).toEqual(["name", "area.east"]);
    });
  });

  describe("GET /api/saved-areas", () => {
    it("lists only the user's own areas, newest first, paged with limit and offset", async () => {
      await save(ada, "First");
      await save(grace, "Grace's");
      await save(ada, "Second");

      const all = savedAreaPageSchema.parse((await ada.get("/api/saved-areas").expect(200)).body);
      expect(all).toMatchObject({ limit: 20, offset: 0, total: 2 });
      expect(all.items.map((area) => area.name)).toEqual(["Second", "First"]);

      const second = savedAreaPageSchema.parse((await ada.get("/api/saved-areas?limit=1&offset=1").expect(200)).body);
      expect(second.items.map((area) => area.name)).toEqual(["First"]);
    });
  });

  describe("PATCH /api/saved-areas/:id", () => {
    it("renames the user's area and bumps updatedAt, leaving the box", async () => {
      const saved = await save(ada, "Chalmers");

      const response = await ada.patch(`/api/saved-areas/${saved.id}`).send({ name: "  Campus  " }).expect(200);

      const renamed = savedAreaSchema.parse(response.body);
      expect(renamed).toMatchObject({ id: saved.id, name: "Campus", area: chalmers, createdAt: saved.createdAt });
      expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(Date.parse(saved.updatedAt));
    });

    it("rejects a blank name", async () => {
      const saved = await save(ada, "Chalmers");

      const response = await ada.patch(`/api/saved-areas/${saved.id}`).send({ name: " " }).expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["name"]);
    });

    it("answers NOT_FOUND for another user's area, as for one that does not exist, and leaves it", async () => {
      const graces = await save(grace, "Grace's");

      await ada.patch(`/api/saved-areas/${graces.id}`).send({ name: "Mine now" }).expect(404);
      await ada.patch(`/api/saved-areas/${missingId}`).send({ name: "Nothing" }).expect(404);

      const list = savedAreaPageSchema.parse((await grace.get("/api/saved-areas").expect(200)).body);
      expect(list.items.map((area) => area.name)).toEqual(["Grace's"]);
    });
  });

  describe("DELETE /api/saved-areas/:id", () => {
    it("deletes the user's area", async () => {
      const saved = await save(ada, "Chalmers");

      await ada.delete(`/api/saved-areas/${saved.id}`).expect(204);

      const list = savedAreaPageSchema.parse((await ada.get("/api/saved-areas").expect(200)).body);
      expect(list.total).toBe(0);
    });

    it("answers NOT_FOUND for another user's area, as for one that does not exist, and leaves it", async () => {
      const graces = await save(grace, "Grace's");

      const other = await ada.delete(`/api/saved-areas/${graces.id}`).expect(404);
      const missing = await ada.delete(`/api/saved-areas/${missingId}`).expect(404);

      expect(errorResponseSchema.parse(other.body).error.code).toBe("NOT_FOUND");
      expect(errorResponseSchema.parse(missing.body).error.code).toBe("NOT_FOUND");
      expect(savedAreaPageSchema.parse((await grace.get("/api/saved-areas").expect(200)).body).total).toBe(1);
    });
  });
});
