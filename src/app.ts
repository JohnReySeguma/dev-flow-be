import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import type { Env } from "./config/env.js";
import type { Features } from "./config/features.js";
import type { Logger } from "./lib/logger.js";
import type { PrismaClient } from "./lib/prisma.js";
import type { Redis } from "./lib/redis.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { requireAuth } from "./middleware/require-auth.js";
import { createAccessTokens } from "./modules/auth/access-token.js";
import { createAuthRepository } from "./modules/auth/auth.repository.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { createConfigRouter } from "./modules/config/config.routes.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { createUsersRepository } from "./modules/users/users.repository.js";
import { createWorkspaceRepository } from "./modules/workspace/workspace.repository.js";
import { buildOpenApiDocument } from "./openapi/document.js";

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
  // upgrade-insecure-requests would break the Swagger UI assets when served over plain http.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // Composition root: repositories → services, shared by the routers that need them.
  const users = createUsersRepository(prisma);
  const auth = createAuthService({
    users,
    workspaces: createWorkspaceRepository(prisma),
    sessions: createAuthRepository(prisma),
    accessTokens: createAccessTokens(env.JWT_SECRET),
    logger,
  });
  const authenticated = requireAuth(auth);

  const api = express.Router();
  api.use("/health", createHealthRouter({ prisma, redis }));
  api.use("/config", createConfigRouter({ features }));
  api.use("/auth", createAuthRouter({ auth, requireAuth: authenticated }));

  const openApi = buildOpenApiDocument();
  api.get("/openapi.json", (_req, res) => {
    res.json(openApi);
  });
  api.use("/docs", swaggerUi.serve, swaggerUi.setup(openApi, { customSiteTitle: "DevFlow API" }));
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
