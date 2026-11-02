import { Redis } from "ioredis";
import type { Logger } from "./logger.js";

export type { Redis };

/**
 * Connects to Redis when `REDIS_URL` is set; returns null otherwise so callers fall back to
 * in-memory implementations. Commands fail fast instead of queueing while Redis is down.
 */
export function createRedisClient(url: string | undefined, logger: Logger): Redis | null {
  if (!url) return null;
  const redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
  let healthy = true;
  redis.on("ready", () => {
    healthy = true;
    logger.info("redis connected");
  });
  redis.on("error", (error: Error) => {
    // ioredis retries forever; log the first failure, not every retry.
    if (healthy) logger.warn({ err: error }, "redis unavailable, retrying");
    healthy = false;
  });
  return redis;
}
