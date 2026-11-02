import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/lib/logger.js";
import { createPrismaClient } from "../../src/lib/prisma.js";
import { createRedisClient } from "../../src/lib/redis.js";
import { testEnv } from "./env.js";

/** The real app wired to the test database (and Redis when configured). Call `close()` in afterAll. */
export function createTestApp() {
  const env = testEnv();
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL, logger);
  const app = createApp({ env, logger, prisma, redis });

  async function close() {
    await prisma.$disconnect();
    redis?.disconnect();
  }

  return { app, env, prisma, close };
}
