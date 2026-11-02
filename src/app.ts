import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import type { Env } from "./config/env.js";
import type { Features } from "./config/features.js";
import type { EmailProvider } from "./integrations/email/index.js";
import { createOAuthProviders } from "./integrations/oauth/index.js";
import type { Logger } from "./lib/logger.js";
import type { PrismaClient } from "./lib/prisma.js";
import type { Redis } from "./lib/redis.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { originCheck } from "./middleware/origin-check.js";
import { requestLogger } from "./middleware/request-logger.js";
import { requireAuth, requireSession } from "./middleware/require-auth.js";
import { createAccessTokens } from "./modules/auth/access-token.js";
import { createAuthRepository } from "./modules/auth/auth.repository.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { createOAuthService } from "./modules/auth/oauth.service.js";
import { createPasswordResetService } from "./modules/auth/password-reset.service.js";
import { createConfigRouter } from "./modules/config/config.routes.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { createUsersRepository } from "./modules/users/users.repository.js";
import { createProjectsRepository } from "./modules/projects/projects.repository.js";
import { createProjectsRouter } from "./modules/projects/projects.routes.js";
import { createProjectsService } from "./modules/projects/projects.service.js";
import { createTokensRepository } from "./modules/tokens/tokens.repository.js";
import { createTokensRouter } from "./modules/tokens/tokens.routes.js";
import { createTokensService } from "./modules/tokens/tokens.service.js";
import { createMeRouter } from "./modules/users/users.routes.js";
import { createUsersService } from "./modules/users/users.service.js";
import { createInviteAcceptRouter } from "./modules/workspace/invites.routes.js";
import { createInvitesService } from "./modules/workspace/invites.service.js";
import { createWorkspaceRepository } from "./modules/workspace/workspace.repository.js";
import { createWorkspaceRouter } from "./modules/workspace/workspace.routes.js";
import { createWorkspaceService } from "./modules/workspace/workspace.service.js";
import { buildOpenApiDocument } from "./openapi/document.js";

export const API_PREFIX = "/api/v1";

export type AppDeps = {
  env: Env;
  features: Features;
  logger: Logger;
  prisma: PrismaClient;
  /** Null when REDIS_URL is not set. */
  redis: Redis | null;
  email: EmailProvider;
  /** Used for OAuth provider calls; tests replace it. */
  fetch?: typeof fetch;
};

/** Builds the Express app. It never listens, so tests can drive it with Supertest. */
export function createApp({ env, features, logger, prisma, redis, email, fetch: fetchImpl }: AppDeps): Express {
  const app = express();

  app.use(requestLogger(logger));
  // upgrade-insecure-requests would break the Swagger UI assets when served over plain http.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // Composition root: repositories → services, shared by the routers that need them.
  const users = createUsersRepository(prisma);
  const workspaces = createWorkspaceRepository(prisma);
  const sessions = createAuthRepository(prisma);
  const auth = createAuthService({
    users,
    workspaces,
    sessions,
    accessTokens: createAccessTokens(env.JWT_SECRET),
    logger,
  });
  const passwords = createPasswordResetService({ users, sessions, email, logger, frontendUrl: env.CORS_ORIGIN });
  const oauth = createOAuthService({
    providers: createOAuthProviders(env, fetchImpl),
    auth,
    users,
    sessions,
    secret: env.JWT_SECRET,
    apiUrl: env.API_URL,
    logger,
  });
  const tokens = createTokensService(createTokensRepository(prisma));
  const authenticated = requireAuth({ auth, tokens });

  const api = express.Router();
  api.use(originCheck(env.CORS_ORIGIN));
  api.use("/health", createHealthRouter({ prisma, redis }));
  api.use("/config", createConfigRouter({ features }));
  const projects = createProjectsService({ projects: createProjectsRepository(prisma) });
  api.use("/projects", createProjectsRouter({ projects, requireAuth: authenticated }));

  const invites = createInvitesService({ workspaces, auth, users, email, logger, frontendUrl: env.CORS_ORIGIN });
  api.use("/invites", createInviteAcceptRouter({ invites }));
  api.use(
    "/workspace",
    createWorkspaceRouter({
      workspace: createWorkspaceService({ workspaces }),
      invites,
      requireAuth: authenticated,
      requireSession,
    }),
  );
  api.use("/me/tokens", createTokensRouter({ tokens, requireAuth: authenticated, requireSession }));
  api.use("/me", createMeRouter({ users: createUsersService(users), requireAuth: authenticated, requireSession }));
  api.use(
    "/auth",
    createAuthRouter({ auth, passwords, oauth, frontendUrl: env.CORS_ORIGIN, requireAuth: authenticated }),
  );

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
