import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time.ts";

const now = Date.parse("2026-10-17T12:00:00.000Z");

function ago(seconds: number): string {
  return new Date(now - seconds * 1000).toISOString();
}

describe("formatRelativeTime", () => {
  it("says just now for under a minute", () => {
    expect(formatRelativeTime(ago(0), now)).toBe("just now");
    expect(formatRelativeTime(ago(59), now)).toBe("just now");
  });

  it("counts in the largest whole unit", () => {
    expect(formatRelativeTime(ago(5 * 60), now)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(3 * 3600), now)).toBe("3 hours ago");
    expect(formatRelativeTime(ago(2 * 86_400), now)).toBe("2 days ago");
    expect(formatRelativeTime(ago(21 * 86_400), now)).toBe("3 weeks ago");
  });

  it("names the previous unit in words", () => {
    expect(formatRelativeTime(ago(86_400), now)).toBe("yesterday");
  });
});
