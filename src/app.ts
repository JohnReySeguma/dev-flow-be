import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { originCheck } from "./middleware/origin-check.js";
import { requestLogger } from "./middleware/request-logger.js";
import { requireAuth, requireSession } from "./middleware/require-auth.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createBootstrapRouter } from "./modules/bootstrap/bootstrap.routes.js";
import { createCommentsRouter } from "./modules/comments/comments.routes.js";
import { createConfigRouter } from "./modules/config/config.routes.js";
import { createGitHubRouter } from "./modules/github/github.routes.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { createIssuesRouter, createProjectIssuesRouter } from "./modules/issues/issues.routes.js";
import { createProjectsRouter } from "./modules/projects/projects.routes.js";
import { createBurndownRouter, createProjectReportsRouter } from "./modules/reports/reports.routes.js";
import { createProjectSprintsRouter, createSprintsRouter } from "./modules/sprints/sprints.routes.js";
import { createTokensRouter } from "./modules/tokens/tokens.routes.js";
import { createMeRouter } from "./modules/users/users.routes.js";
import { createWorkflowRouter } from "./modules/workflow/workflow.routes.js";
import { createInviteAcceptRouter } from "./modules/workspace/invites.routes.js";
import { createWorkspaceRouter } from "./modules/workspace/workspace.routes.js";
import { buildOpenApiDocument } from "./openapi/document.js";
import { createServices, type ServiceDeps, type Services } from "./services.js";

export const API_PREFIX = "/api/v1";

/** Response headers the frontend reads: ETag (for If-Match) and the request id (for error reports). */
const EXPOSED_HEADERS = ["ETag", "X-Request-Id"];

export type AppDeps = ServiceDeps & {
  /** Shared with the realtime server; built from the other deps when omitted (e.g. in tests). */
  services?: Services;
};

/** Builds the Express app. It never listens, so tests can drive it with Supertest. */
export function createApp(deps: AppDeps): Express {
  const { env, logger, prisma, redis } = deps;
  const services = deps.services ?? createServices(deps);
  const app = express();

  app.use(requestLogger(logger));
  // upgrade-insecure-requests would break the Swagger UI assets when served over plain http.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  // The frontend is cross-origin: without exposedHeaders its JavaScript could not read these.
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true, exposedHeaders: EXPOSED_HEADERS }));
  // Before express.json: webhook signatures cover the raw body. Outside `api`: no Origin check.
  app.use(
    `${API_PREFIX}/integrations/github`,
    createGitHubRouter({
      github: services.github,
      secret: deps.features.githubIntegration ? (env.GITHUB_WEBHOOK_SECRET ?? null) : null,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const authenticated = requireAuth({ auth: services.auth, tokens: services.tokens });
  const withAuth = { requireAuth: authenticated };

  const api = express.Router();
  api.use(originCheck(env.CORS_ORIGIN));
  api.use("/health", createHealthRouter({ prisma, redis }));
  api.use("/config", createConfigRouter({ config: services.config }));
  api.use("/bootstrap", createBootstrapRouter({ bootstrap: services.bootstrap, ...withAuth }));
  api.use("/projects/:key/issues", createProjectIssuesRouter({ issues: services.issues, ...withAuth }));
  api.use("/projects/:key/sprints", createProjectSprintsRouter({ sprints: services.sprints, ...withAuth }));
  api.use("/projects/:key/reports", createProjectReportsRouter({ reports: services.reports, ...withAuth }));
  api.use("/projects/:key/statuses", createWorkflowRouter({ workflow: services.workflow, ...withAuth }));
  api.use("/projects", createProjectsRouter({ projects: services.projects, ...withAuth }));
  api.use("/sprints/:id/burndown", createBurndownRouter({ reports: services.reports, ...withAuth }));
  api.use("/sprints", createSprintsRouter({ sprints: services.sprints, ...withAuth }));
  api.use("/issues/:issueKey/comments", createCommentsRouter({ comments: services.comments, ...withAuth }));
  api.use("/issues", createIssuesRouter({ issues: services.issues, ...withAuth }));
  api.use("/invites", createInviteAcceptRouter({ invites: services.invites }));
  api.use(
    "/workspace",
    createWorkspaceRouter({ workspace: services.workspace, invites: services.invites, ...withAuth, requireSession }),
  );
  api.use("/me/tokens", createTokensRouter({ tokens: services.tokens, ...withAuth, requireSession }));
  api.use("/me", createMeRouter({ users: services.users, ...withAuth, requireSession }));
  api.use(
    "/auth",
    createAuthRouter({
      auth: services.auth,
      passwords: services.passwords,
      oauth: services.oauth,
      frontendUrl: env.CORS_ORIGIN,
      ...withAuth,
    }),
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
