import { describe, expect, it } from "vitest";
import { createItemBodySchema, itemSchema, updateItemBodySchema } from "./items.js";

const userId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";
const item = {
  id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
  userId,
  name: "Widget",
  description: null,
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
};

describe("itemSchema", () => {
  it("strips properties the API does not declare", () => {
    expect(itemSchema.parse({ ...item, internalNote: "secret" })).toEqual(item);
  });
});

describe("createItemBodySchema", () => {
  it("trims the name and leaves the description optional", () => {
    expect(createItemBodySchema.parse({ name: "  Widget  " })).toEqual({ name: "Widget" });
  });

  it("takes no owner: an item belongs to whoever creates it", () => {
    expect(createItemBodySchema.safeParse({ userId, name: "Widget" }).success).toBe(false);
  });

  it("rejects a blank or overlong name", () => {
    expect(createItemBodySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createItemBodySchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(createItemBodySchema.safeParse({ name: "Widget", nmae: "Typo" }).success).toBe(false);
  });
});

describe("updateItemBodySchema", () => {
  it("accepts any subset of fields, including a null description", () => {
    expect(updateItemBodySchema.parse({})).toEqual({});
    expect(updateItemBodySchema.parse({ description: null })).toEqual({ description: null });
  });

  it("does not move an item to another user", () => {
    expect(updateItemBodySchema.safeParse({ userId }).success).toBe(false);
  });
});
