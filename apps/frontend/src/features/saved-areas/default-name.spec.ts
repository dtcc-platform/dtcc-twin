import { describe, expect, it } from "vitest";
import { defaultAreaName } from "./default-name.ts";

describe("defaultAreaName", () => {
  it("names an area after when it was saved, to the minute", () => {
    expect(defaultAreaName(new Date(2026, 9, 18, 14, 5))).toBe("Area 18 Oct, 14:05");
  });
});
