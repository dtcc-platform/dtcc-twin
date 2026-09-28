import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safe-redirect.ts";

describe("safeRedirect", () => {
  it("keeps a path on this site, with its search", () => {
    expect(safeRedirect("/items?offset=10")).toBe("/items?offset=10");
  });

  it.each([
    ["nothing", undefined],
    ["another site", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash the browser reads as a slash", "/\\evil.example"],
    ["a relative path", "items"],
  ])("falls back to home for %s", (_, target) => {
    expect(safeRedirect(target)).toBe("/");
  });
});
