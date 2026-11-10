import type { Logger } from "@nestjs/common";

/** Runs after each interval of idle time; stopping waits for the current task. */
export function every(intervalMs: number, task: () => Promise<void>, logger: Logger): { stop(): Promise<void> } {
  let stopped = false;
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(): void {
    if (stopped || intervalMs <= 0) return;
    timer = setTimeout(() => {
      active = Promise.resolve()
        .then(task)
        .catch((error: unknown) => {
          logger.error(error instanceof Error ? error.message : "Background task failed");
        })
        .finally(schedule);
    }, intervalMs);
    timer.unref();
  }
  schedule();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await active;
    },
  };
}
