import type { INestApplication } from "@nestjs/common";
import type { User } from "@repo/contracts";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsersService } from "../../src/modules/users/users.service.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { truncateAllTables } from "../helpers/database.js";

// The user record, which other modules read. Its routes belong to accounts.
describe("UsersService (e2e)", () => {
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
