import { describe, expect, it } from "vitest";
import { apiKeySchema, createApiKeyBodySchema, createdApiKeySchema, userKeyParamsSchema } from "./keys.js";

const apiKey = {
  id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
  userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
  name: "Laptop",
  description: null,
  prefix: "dtcc_AbCdEfG",
  createdAt: "2026-10-18T10:00:00.000Z",
};

describe("apiKeySchema", () => {
  it("strips properties the API does not declare, such as the key itself", () => {
    expect(apiKeySchema.parse({ ...apiKey, key: "dtcc_secret" })).toEqual(apiKey);
  });
});

describe("createdApiKeySchema", () => {
  it("carries the key, which is shown only once", () => {
    expect(createdApiKeySchema.parse({ ...apiKey, key: "dtcc_secret" })).toEqual({ ...apiKey, key: "dtcc_secret" });
  });
});

describe("createApiKeyBodySchema", () => {
  it("trims the name and leaves the description optional", () => {
    expect(createApiKeyBodySchema.parse({ name: "  Laptop  " })).toEqual({ name: "Laptop" });
    expect(createApiKeyBodySchema.parse({ name: "Laptop", description: " CI runner " })).toEqual({
      name: "Laptop",
      description: "CI runner",
    });
  });

  it("rejects a blank or overlong name and an overlong description", () => {
    expect(createApiKeyBodySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createApiKeyBodySchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(createApiKeyBodySchema.safeParse({ name: "Laptop", description: "x".repeat(501) }).success).toBe(false);
  });

  it("takes no key, prefix or owner: the backend makes those", () => {
    expect(createApiKeyBodySchema.safeParse({ name: "Laptop", key: "dtcc_mine" }).success).toBe(false);
    expect(createApiKeyBodySchema.safeParse({ name: "Laptop", prefix: "dtcc_" }).success).toBe(false);
    expect(createApiKeyBodySchema.safeParse({ name: "Laptop", userId: apiKey.userId }).success).toBe(false);
  });
});

describe("userKeyParamsSchema", () => {
  it("needs the user's id and the key's id, both UUIDs", () => {
    expect(userKeyParamsSchema.parse({ id: apiKey.userId, keyId: apiKey.id })).toEqual({
      id: apiKey.userId,
      keyId: apiKey.id,
    });
    expect(userKeyParamsSchema.safeParse({ id: apiKey.userId, keyId: "not-a-uuid" }).success).toBe(false);
    expect(userKeyParamsSchema.safeParse({ keyId: apiKey.id }).success).toBe(false);
  });
});
