import { describe, expect, it } from "vitest";
import { initials } from "./initials.ts";

describe("initials", () => {
  it.each([
    ["one word", "Ada", "A"],
    ["two words", "Ada Lovelace", "AL"],
    ["first and last of several", "Ana María López", "AL"],
    ["lowercase", "grace hopper", "GH"],
    ["extra spaces", "  Ada   Lovelace ", "AL"],
    ["an accented first letter", "Émile Zola", "ÉZ"],
    ["a letter outside the BMP", "𝒜da", "𝒜"],
  ])("takes %s", (_case, name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it("falls back to a question mark for a blank name", () => {
    expect(initials("   ")).toBe("?");
  });
});
