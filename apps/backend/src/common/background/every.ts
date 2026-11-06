import type { Logger } from "@nestjs/common";

export type Repeating = {
  /** No run starts after this; resolves once the run in progress, if any, has finished. */
  stop: () => Promise<void>;
};

/**
 * Runs `task` every `intervalMs`, counted from the end of the previous run, so two runs never overlap. A failed run is
 * logged and the next one goes ahead. The first run is one interval from now.
 */
export function every(intervalMs: number, task: () => Promise<void>, logger: Logger): Repeating {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(run, intervalMs);
    // A pending run must not keep the process alive on its own.
    timer.unref();
  }

  function run(): void {
    running = task()
      .catch((error: unknown) => {
        logger.error(`Background run failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        running = undefined;
        schedule();
      });
  }

  schedule();
  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
