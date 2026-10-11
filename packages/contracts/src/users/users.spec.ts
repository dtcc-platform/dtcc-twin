import { describe, expect, it } from "vitest";
import {
  createUserBodySchema,
  setUserStatusBodySchema,
  setUserTierBodySchema,
  updateUserBodySchema,
  userListQuerySchema,
  userSchema,
} from "./users.js";

const user = {
  id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
  email: "ada@example.com",
  name: "Ada",
  role: "user",
  status: "pending",
  tier: "default",
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
};

const newUser = { email: "ada@example.com", name: "Ada", password: "correct horse" };

describe("userSchema", () => {
  it("strips properties the API does not declare", () => {
    expect(userSchema.parse({ ...user, passwordHash: "secret" })).toEqual(user);
  });

  it("rejects an unknown role", () => {
    expect(userSchema.safeParse({ ...user, role: "owner" }).success).toBe(false);
  });

  it("requires a known status and tier", () => {
    expect(userSchema.safeParse({ ...user, status: "banned" }).success).toBe(false);
    expect(userSchema.safeParse({ ...user, tier: "gold" }).success).toBe(false);
    const { status: _, ...withoutStatus } = user;
    expect(userSchema.safeParse(withoutStatus).success).toBe(false);
  });
});

describe("userListQuerySchema", () => {
  it("pages by default and filters by an optional status", () => {
    expect(userListQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(userListQuerySchema.parse({ status: "pending", limit: "5" })).toEqual({
      status: "pending",
      limit: 5,
      offset: 0,
    });
    expect(userListQuerySchema.safeParse({ status: "banned" }).success).toBe(false);
  });
});

describe("setUserStatusBodySchema", () => {
  it("sets a user active or disabled, never back to pending", () => {
    expect(setUserStatusBodySchema.parse({ status: "active" })).toEqual({ status: "active" });
    expect(setUserStatusBodySchema.parse({ status: "disabled" })).toEqual({ status: "disabled" });
    expect(setUserStatusBodySchema.safeParse({ status: "pending" }).success).toBe(false);
    expect(setUserStatusBodySchema.safeParse({}).success).toBe(false);
  });

  it("changes nothing but the status", () => {
    expect(setUserStatusBodySchema.safeParse({ status: "active", tier: "elevated" }).success).toBe(false);
  });
});

describe("setUserTierBodySchema", () => {
  it("takes a known tier and nothing else", () => {
    expect(setUserTierBodySchema.parse({ tier: "elevated" })).toEqual({ tier: "elevated" });
    expect(setUserTierBodySchema.safeParse({ tier: "gold" }).success).toBe(false);
    expect(setUserTierBodySchema.safeParse({ tier: "default", status: "active" }).success).toBe(false);
  });
});

describe("createUserBodySchema", () => {
  it("trims the name", () => {
    expect(createUserBodySchema.parse({ ...newUser, name: "  Ada  " })).toEqual(newUser);
  });

  it("rejects an invalid email", () => {
    expect(createUserBodySchema.safeParse({ ...newUser, email: "ada" }).success).toBe(false);
    expect(createUserBodySchema.safeParse({ ...newUser, email: `${"a".repeat(250)}@x.io` }).success).toBe(false);
  });

  it("requires a password of 8 to 128 characters and nothing more", () => {
    const { password: _, ...withoutPassword } = newUser;
    expect(createUserBodySchema.safeParse(withoutPassword).success).toBe(false);
    expect(createUserBodySchema.safeParse({ ...newUser, password: "1234567" }).success).toBe(false);
    expect(createUserBodySchema.safeParse({ ...newUser, password: "a".repeat(129) }).success).toBe(false);
    expect(createUserBodySchema.parse({ ...newUser, password: "abcdefgh" }).password).toBe("abcdefgh");
    expect(createUserBodySchema.parse({ ...newUser, password: "a".repeat(128) }).password).toHaveLength(128);
  });

  it("keeps a password's surrounding spaces", () => {
    expect(createUserBodySchema.parse({ ...newUser, password: "  spaced  " }).password).toBe("  spaced  ");
  });

  it("takes an optional role", () => {
    expect(createUserBodySchema.parse({ ...newUser, role: "admin" }).role).toBe("admin");
    expect(createUserBodySchema.parse(newUser).role).toBeUndefined();
    expect(createUserBodySchema.safeParse({ ...newUser, role: "owner" }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(createUserBodySchema.safeParse({ ...newUser, nmae: "Ada" }).success).toBe(false);
  });
});

describe("updateUserBodySchema", () => {
  it("accepts any subset of fields", () => {
    expect(updateUserBodySchema.parse({})).toEqual({});
    expect(updateUserBodySchema.parse({ name: "Grace" })).toEqual({ name: "Grace" });
  });

  it("changes neither the password nor the role", () => {
    expect(updateUserBodySchema.safeParse({ password: "new password" }).success).toBe(false);
    expect(updateUserBodySchema.safeParse({ role: "admin" }).success).toBe(false);
  });

  it("changes neither the status nor the tier, which have routes of their own", () => {
    expect(updateUserBodySchema.safeParse({ status: "active" }).success).toBe(false);
    expect(updateUserBodySchema.safeParse({ tier: "elevated" }).success).toBe(false);
  });
});
