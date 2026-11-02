import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";
import { createShutdown } from "./shutdown.js";

const logger = createLogger({ NODE_ENV: "test" });

describe("createShutdown", () => {
  it("closes every task in order, then exits with 0", async () => {
    const closed: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      logger,
      exit,
      tasks: ["http", "database"].map((name) => ({
        name,
        close: () => {
          closed.push(name);
          return Promise.resolve();
        },
      })),
    });

    await shutdown("SIGTERM");

    expect(closed).toEqual(["http", "database"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("keeps closing after a failure and exits with 1", async () => {
    const exit = vi.fn();
    const closeDatabase = vi.fn(() => Promise.resolve());
    const shutdown = createShutdown({
      logger,
      exit,
      tasks: [
        { name: "http", close: () => Promise.reject(new Error("boom")) },
        { name: "database", close: closeDatabase },
      ],
    });

    await shutdown("SIGTERM");

    expect(closeDatabase).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("ignores repeated signals", async () => {
    const exit = vi.fn();
    const close = vi.fn(() => Promise.resolve());
    const shutdown = createShutdown({ logger, exit, tasks: [{ name: "http", close }] });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(close).toHaveBeenCalledOnce();
  });

  it("forces exit when a task hangs past the timeout", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = createShutdown({
      logger,
      exit,
      timeoutMs: 1000,
      tasks: [{ name: "http", close: () => new Promise(() => undefined) }],
    });

    void shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(1000);

    expect(exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});
