import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Env } from "./config/env.js";
import type { Features } from "./config/features.js";
import type { Logger } from "./lib/logger.js";
import type { PrismaClient } from "./lib/prisma.js";
import type { Redis } from "./lib/redis.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { createConfigRouter } from "./modules/config/config.routes.js";
import { createHealthRouter } from "./modules/health/health.routes.js";

export const API_PREFIX = "/api/v1";

export type AppDeps = {
  env: Env;
  features: Features;
  logger: Logger;
  prisma: PrismaClient;
  /** Null when REDIS_URL is not set. */
  redis: Redis | null;
};

/** Builds the Express app. It never listens, so tests can drive it with Supertest. */
export function createApp({ env, features, logger, prisma, redis }: AppDeps): Express {
  const app = express();

  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use("/health", createHealthRouter({ prisma, redis }));
  api.use("/config", createConfigRouter({ features }));
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
