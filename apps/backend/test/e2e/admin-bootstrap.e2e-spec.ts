import type { INestApplication } from "@nestjs/common";
import { userSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccountsService } from "../../src/modules/accounts/accounts.service.js";
import { UsersService } from "../../src/modules/users/users.service.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { query, truncateAllTables } from "../helpers/database.js";

// A deploy's `node dist/migrate.js` calls ensureAdmin with ADMIN_EMAIL and ADMIN_PASSWORD after migrating.
describe("The first administrator (e2e)", () => {
  let app: INestApplication<App>;
  const password = "a-long-admin-password";

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  it("is created active when the database has no active admin, and can log in", async () => {
    await app.get(UsersService).register({ email: "early@example.com", name: "Early", password });

    const admin = await app.get(AccountsService).ensureAdmin("admin@example.com", password);

    expect(admin).toMatchObject({ email: "admin@example.com", role: "admin", status: "active" });
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password })
      .expect(200);
    expect(userSchema.parse(login.body).role).toBe("admin");
  });

  it("is left alone once an active admin exists, whatever the email", async () => {
    await app.get(UsersService).create({ email: "first@example.com", name: "First", password, role: "admin" });

    expect(await app.get(AccountsService).ensureAdmin("admin@example.com", password)).toBeUndefined();
    expect(await query("select email from users")).toEqual([{ email: "first@example.com" }]);
  });

  it("is left alone when run again", async () => {
    await app.get(AccountsService).ensureAdmin("admin@example.com", password);

    expect(await app.get(AccountsService).ensureAdmin("admin@example.com", "another-long-password")).toBeUndefined();
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password })
      .expect(200);
  });
});
