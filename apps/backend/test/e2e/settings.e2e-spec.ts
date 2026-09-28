import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, settingsSchema } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsersService } from "../../src/modules/users/users.service.js";
import { authHeader } from "../helpers/auth.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { truncateAllTables } from "../helpers/database.js";

describe("Settings (e2e)", () => {
  let app: INestApplication<App>;
  let ada: Agent;
  let adaId: string;

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
  });

  async function loggedIn(email: string): Promise<{ agent: Agent; userId: string }> {
    const user = await app.get(UsersService).create({ email, name: "Owner", password: "correct horse" });
    const agent = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
    return { agent, userId: user.id };
  }

  it("GET answers the user's defaults before anything is stored", async () => {
    const response = await ada.get("/api/settings").expect(200);

    expect(settingsSchema.parse(response.body)).toEqual({
      userId: adaId,
      theme: "system",
      notificationsEnabled: true,
    });
  });

  it("PATCH stores the given fields on first write and changes only those afterwards", async () => {
    const first = await ada.patch("/api/settings").send({ theme: "dark" }).expect(200);
    expect(settingsSchema.parse(first.body)).toEqual({ userId: adaId, theme: "dark", notificationsEnabled: true });

    await ada.patch("/api/settings").send({ notificationsEnabled: false }).expect(200);

    const stored = await ada.get("/api/settings").expect(200);
    expect(settingsSchema.parse(stored.body)).toEqual({ userId: adaId, theme: "dark", notificationsEnabled: false });
  });

  it("keeps each user's settings to themselves", async () => {
    const { agent: grace } = await loggedIn("grace@example.com");
    await ada.patch("/api/settings").send({ theme: "dark" }).expect(200);

    const response = await grace.get("/api/settings").expect(200);

    expect(settingsSchema.parse(response.body).theme).toBe("system");
  });

  it("rejects an unknown theme", async () => {
    const response = await ada.patch("/api/settings").send({ theme: "sepia" }).expect(400);

    expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["theme"]);
  });

  it("needs a logged-in user", async () => {
    const response = await request(app.getHttpServer()).get("/api/settings").expect(401);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });
});
