import { describe, expect, it } from "vitest";
import { limitMessage } from "./job-limit.js";

const at = (time: string) => Date.parse(`2026-11-08T${time}Z`);

describe("limitMessage", () => {
  it("names the limit and the minutes until the next clock hour", () => {
    expect(limitMessage(10, at("14:37:00"))).toBe("You can run up to 10 jobs an hour. Try again in 23 minutes.");
  });

  it("rounds the minutes up, so a retry never comes before the hour", () => {
    expect(limitMessage(10, at("14:59:30"))).toBe("You can run up to 10 jobs an hour. Try again in 1 minute.");
    expect(limitMessage(10, at("14:00:00.001"))).toBe("You can run up to 10 jobs an hour. Try again in 60 minutes.");
  });

  it("counts a whole hour at the top of the hour", () => {
    expect(limitMessage(10, at("14:00:00"))).toBe("You can run up to 10 jobs an hour. Try again in 60 minutes.");
  });

  it("says job for a limit of one", () => {
    expect(limitMessage(1, at("14:37:00"))).toBe("You can run up to 1 job an hour. Try again in 23 minutes.");
  });
});
