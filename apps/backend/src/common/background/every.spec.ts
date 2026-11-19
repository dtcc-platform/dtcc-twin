import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { every } from "./every.js";

afterEach(() => vi.useRealTimers());
describe("every", () => {
  it("waits an interval after completion and never overlaps runs", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const loop = every(100, task, new Logger("test"));
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(task).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(99);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    finish();
    await loop.stop();
  });
  it("logs a rejected run and continues", async () => {
    vi.useFakeTimers();
    const logger = new Logger("test");
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const task = vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValue(undefined);
    const loop = every(100, task, logger);
    await vi.advanceTimersByTimeAsync(200);
    expect(task).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalled();
    await loop.stop();
  });
  it("waits for an active run on stop and starts no more", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const loop = every(100, task, new Logger("test"));
    await vi.advanceTimersByTimeAsync(100);
    let stopped = false;
    const stop = loop.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped).toBe(false);
    finish();
    await stop;
    await vi.advanceTimersByTimeAsync(500);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
