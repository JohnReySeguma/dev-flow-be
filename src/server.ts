import { createServer } from "node:http";
import { API_PREFIX, createApp } from "./app.js";
import { EnvError, loadEnv, type Env } from "./config/env.js";
import { describeFeatures, resolveFeatures } from "./config/features.js";
import { createEmailProvider } from "./integrations/email/index.js";
import { createLogger } from "./lib/logger.js";
import { createPrismaClient } from "./lib/prisma.js";
import { createRedisClient } from "./lib/redis.js";
import { createShutdown } from "./lib/shutdown.js";
import { createRealtimeServer } from "./realtime/server.js";
import { createServices } from "./services.js";

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
const deps = { env, features, logger, prisma, redis, email: createEmailProvider(env, logger) };
const services = createServices(deps);
const app = createApp({ ...deps, services });
const server = createServer(app);
const realtime = createRealtimeServer({
  httpServer: server,
  env,
  logger,
  redis,
  auth: services.auth,
  tokens: services.tokens,
  projects: services.projects,
  events: services.events,
});

const shutdown = createShutdown({
  logger,
  tasks: [
    // Sockets first: open WebSocket connections would otherwise keep the HTTP server from closing.
    { name: "realtime", close: () => realtime.close() },
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
