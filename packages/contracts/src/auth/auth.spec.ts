import { describe, expect, it } from "vitest";
import { loginBodySchema, registerBodySchema } from "./auth.js";

const newUser = { email: "ada@example.com", name: "Ada", password: "correct horse" };

describe("registerBodySchema", () => {
  it("takes what an admin's create takes", () => {
    expect(registerBodySchema.parse({ ...newUser, name: "  Ada  " })).toEqual(newUser);
    expect(registerBodySchema.safeParse({ ...newUser, password: "1234567" }).success).toBe(false);
  });

  it("rejects a role, so nobody can sign up as an admin", () => {
    expect(registerBodySchema.safeParse({ ...newUser, role: "admin" }).success).toBe(false);
  });
});

describe("loginBodySchema", () => {
  it("accepts any password up to the maximum, so one set under older rules still logs in", () => {
    expect(loginBodySchema.parse({ email: "ada@example.com", password: "short" }).password).toBe("short");
    expect(loginBodySchema.safeParse({ email: "ada@example.com", password: "" }).success).toBe(false);
    expect(loginBodySchema.safeParse({ email: "ada@example.com", password: "a".repeat(129) }).success).toBe(false);
  });
});
