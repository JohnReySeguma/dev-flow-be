import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Env } from "./config/env.js";
import type { Logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";

export const API_PREFIX = "/api/v1";

export type AppDeps = {
  env: Env;
  logger: Logger;
};

/** Builds the Express app. It never listens, so tests can drive it with Supertest. */
export function createApp({ env, logger }: AppDeps): Express {
  const app = express();

  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = express.Router();
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
