import type { Logger } from "./logger.js";

export type ShutdownTask = { name: string; close: () => Promise<void> };

type ShutdownOptions = {
  logger: Logger;
  /** Closed in order: stop accepting traffic first, release shared resources last. */
  tasks: ShutdownTask[];
  timeoutMs?: number;
  exit?: (code: number) => void;
};

/**
 * Returns an idempotent shutdown routine for SIGTERM/SIGINT. If the tasks hang past the
 * timeout the process exits anyway, so an orchestrator is never left waiting.
 */
export function createShutdown({
  logger,
  tasks,
  timeoutMs = 10_000,
  exit = (code) => process.exit(code),
}: ShutdownOptions) {
  let started = false;

  return async function shutdown(signal: string): Promise<void> {
    if (started) return;
    started = true;
    logger.info({ signal }, "shutting down");

    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, "shutdown timed out, forcing exit");
      exit(1);
    }, timeoutMs);
    timer.unref();

    let failed = false;
    for (const task of tasks) {
      try {
        await task.close();
        logger.info(`closed ${task.name}`);
      } catch (error) {
        failed = true;
        logger.error({ err: error }, `failed to close ${task.name}`);
      }
    }
    clearTimeout(timer);
    exit(failed ? 1 : 0);
  };
}
