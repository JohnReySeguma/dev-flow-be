import { createApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { resolveFeatures } from "../../src/config/features.js";
import { createLogger } from "../../src/lib/logger.js";
import { createPrismaClient } from "../../src/lib/prisma.js";
import { createRedisClient } from "../../src/lib/redis.js";
import { createMemoryEmailProvider } from "./email.js";
import { testEnv } from "./env.js";

type TestAppOptions = { env?: Partial<Env>; fetch?: typeof fetch };

/** The real app wired to the test database (and Redis when configured). Call `close()` in afterAll. */
export function createTestApp(options: TestAppOptions = {}) {
  const env: Env = { ...testEnv(), ...options.env };
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL, logger);
  const email = createMemoryEmailProvider();
  const app = createApp({
    env,
    features: resolveFeatures(env),
    logger,
    prisma,
    redis,
    email,
    ...(options.fetch && { fetch: options.fetch }),
  });

  async function close() {
    await prisma.$disconnect();
    redis?.disconnect();
  }

  return { app, env, prisma, email, close };
}
