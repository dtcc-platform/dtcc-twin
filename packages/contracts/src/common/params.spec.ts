import { describe, expect, it } from "vitest";
import { idParamsSchema } from "./params.js";

describe("idParamsSchema", () => {
  it("accepts a UUID id", () => {
    const params = { id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b" };

    expect(idParamsSchema.parse(params)).toEqual(params);
  });

  it("rejects an id that is not a UUID", () => {
    expect(idParamsSchema.safeParse({ id: "42" }).success).toBe(false);
  });
});
