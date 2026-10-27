import type { INestApplication } from "@nestjs/common";
import { errorResponseSchema, userSchema, type User } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsersService } from "../../src/modules/users/users.service.js";
import { authHeader } from "../helpers/auth.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { truncateAllTables } from "../helpers/database.js";

// The caller's own account. Admin routes on other users are in accounts-admin.e2e-spec.ts.
describe("Own account routes (e2e)", () => {
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

  function createUser(body: { email: string; name: string }): Promise<User> {
    return app.get(UsersService).create({ password: "correct horse", ...body });
  }

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
});
