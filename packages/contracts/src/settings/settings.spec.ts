import { describe, expect, it } from "vitest";
import { updateSettingsBodySchema } from "./settings.js";

describe("updateSettingsBodySchema", () => {
  it("accepts any subset of fields", () => {
    expect(updateSettingsBodySchema.parse({})).toEqual({});
    expect(updateSettingsBodySchema.parse({ theme: "dark" })).toEqual({ theme: "dark" });
  });

  it("rejects an unknown theme", () => {
    expect(updateSettingsBodySchema.safeParse({ theme: "sepia" }).success).toBe(false);
  });
});
