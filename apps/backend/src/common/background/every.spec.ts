import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { every } from "./every.js";

describe("every", () => {
  const logger = new Logger("every.spec");

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A task that stays running until the test lets it finish.
  function heldTask() {
    let release: () => void = () => undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    return {
      task,
      release: () => {
        release();
      },
    };
  }

  it("runs the task once per interval, the first time one interval from now", async () => {
    const task = vi.fn(() => Promise.resolve());
    const repeating = every(1000, task, logger);

    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(3);

    await repeating.stop();
  });

  it("never starts a run while the previous one is still going, and counts the interval from its end", async () => {
    const { task, release } = heldTask();
    const repeating = every(1000, task, logger);

    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    release();
    await repeating.stop();
  });

  it("logs a failed run and keeps going", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const task = vi.fn().mockRejectedValueOnce(new Error("engine down")).mockResolvedValue(undefined);
    const repeating = every(1000, task, logger);

    await vi.advanceTimersByTimeAsync(2000);

    expect(task).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("engine down"));
    await repeating.stop();
  });

  it("stops scheduling runs, and stop() waits for the run in progress to finish", async () => {
    const { task, release } = heldTask();
    const repeating = every(1000, task, logger);
    await vi.advanceTimersByTimeAsync(1000);

    let stopped = false;
    const stopping = repeating.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
