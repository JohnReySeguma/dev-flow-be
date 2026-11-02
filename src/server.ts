import { createServer } from "node:http";
import { API_PREFIX, createApp } from "./app.js";
import { EnvError, loadEnv, type Env } from "./config/env.js";
import { describeFeatures, resolveFeatures } from "./config/features.js";
import { createLogger } from "./lib/logger.js";
import { createPrismaClient } from "./lib/prisma.js";
import { createRedisClient } from "./lib/redis.js";
import { createShutdown } from "./lib/shutdown.js";

function readEnv(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnv();
const logger = createLogger(env);
const features = resolveFeatures(env);
logger.info(describeFeatures(features), "active modes");

const prisma = createPrismaClient(env.DATABASE_URL);
const redis = createRedisClient(env.REDIS_URL, logger);
const app = createApp({ env, features, logger, prisma, redis });
const server = createServer(app);

const shutdown = createShutdown({
  logger,
  tasks: [
    {
      name: "http server",
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
          // Let in-flight requests finish, but drop idle keep-alive sockets right away.
          server.closeIdleConnections();
        }),
    },
    ...(redis
      ? [
          {
            name: "redis",
            close: async () => {
              await redis.quit();
            },
          },
        ]
      : []),
    { name: "database", close: () => prisma.$disconnect() },
  ],
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void shutdown(signal));
}

server.once("error", (error: NodeJS.ErrnoException) => {
  const message =
    error.code === "EADDRINUSE"
      ? `port ${env.PORT} is already in use: stop the other process (e.g. \`docker compose stop api\`) or set PORT`
      : "http server failed to start";
  logger.fatal({ err: error }, message);
  void Promise.allSettled([prisma.$disconnect(), redis?.quit()]).finally(() => process.exit(1));
});

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, `api listening on http://localhost:${env.PORT}${API_PREFIX}`);
});
