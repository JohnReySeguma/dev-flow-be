import type { Env } from "./config/env.js";
import type { Features } from "./config/features.js";
import { copySampleTracker, resetDemoTracker, resetSampleTracker } from "./demo/seed.js";
import type { EmailProvider } from "./integrations/email/index.js";
import { createOAuthProviders } from "./integrations/oauth/index.js";
import type { Logger } from "./lib/logger.js";
import type { PrismaClient } from "./lib/prisma.js";
import type { Redis } from "./lib/redis.js";
import { createAccessTokens } from "./modules/auth/access-token.js";
import { createAuthRepository } from "./modules/auth/auth.repository.js";
import { createAuthService, personalWorkspaceName } from "./modules/auth/auth.service.js";
import { createOAuthService } from "./modules/auth/oauth.service.js";
import { createEmailVerificationService } from "./modules/auth/email-verification.service.js";
import { createPasswordResetService } from "./modules/auth/password-reset.service.js";
import { createBootstrapService } from "./modules/bootstrap/bootstrap.service.js";
import { createCommentsRepository } from "./modules/comments/comments.repository.js";
import { createCommentsService } from "./modules/comments/comments.service.js";
import { createConfigService } from "./modules/config/config.service.js";
import { createIssuesRepository } from "./modules/issues/issues.repository.js";
import { createIssuesService } from "./modules/issues/issues.service.js";
import { createProjectsRepository } from "./modules/projects/projects.repository.js";
import { createProjectsService } from "./modules/projects/projects.service.js";
import { createReportsRepository } from "./modules/reports/reports.repository.js";
import { createReportsService } from "./modules/reports/reports.service.js";
import { createSprintsRepository } from "./modules/sprints/sprints.repository.js";
import { createSprintsService } from "./modules/sprints/sprints.service.js";
import { createTokensRepository } from "./modules/tokens/tokens.repository.js";
import { createTokensService } from "./modules/tokens/tokens.service.js";
import { createUsersRepository } from "./modules/users/users.repository.js";
import { createUsersService } from "./modules/users/users.service.js";
import { createWorkflowRepository } from "./modules/workflow/workflow.repository.js";
import { createWorkflowService } from "./modules/workflow/workflow.service.js";
import { createGitHubAppClient } from "./integrations/github/app-client.js";
import { createGitHubRepository } from "./modules/github/github.repository.js";
import { createGitHubService } from "./modules/github/github.service.js";
import { createInvitesService } from "./modules/workspace/invites.service.js";
import { createWorkspaceRepository } from "./modules/workspace/workspace.repository.js";
import { createWorkspaceService } from "./modules/workspace/workspace.service.js";
import { createEventBus, type EventBus } from "./realtime/events.js";

export type ServiceDeps = {
  env: Env;
  features: Features;
  logger: Logger;
  prisma: PrismaClient;
  /** Null when REDIS_URL is not set. */
  redis: Redis | null;
  email: EmailProvider;
  /** Where services publish Live Sync events; the realtime server attaches to it. */
  events?: EventBus;
  /** Used for OAuth provider calls; tests replace it. */
  fetch?: typeof fetch;
};

/**
 * The composition root: repositories → services, built once and shared by the HTTP routers and
 * the realtime server.
 */
export function createServices(deps: ServiceDeps) {
  const { env, features, logger, prisma, email } = deps;
  const events = deps.events ?? createEventBus();

  const users = createUsersRepository(prisma);
  const workspaces = createWorkspaceRepository(prisma);
  const sessions = createAuthRepository(prisma);
  const workspace = createWorkspaceService({
    workspaces,
    copySampleData: (workspaceId, ownerId) => copySampleTracker(prisma, workspaceId, ownerId),
    resetSampleData: (target, userId) =>
      target.isDemo ? resetDemoTracker(prisma, target.id) : resetSampleTracker(prisma, target.id, userId),
  });
  const auth = createAuthService({
    users,
    workspaces,
    sessions,
    accessTokens: createAccessTokens(env.JWT_SECRET),
    logger,
    // Every new account starts with its own workspace, pre-filled so it isn't empty.
    createPersonalWorkspace: async (user) => {
      await workspace.create(user.id, { name: personalWorkspaceName(user.name), sampleData: true });
    },
  });
  const projects = createProjectsService({ projects: createProjectsRepository(prisma), events });
  const issues = createIssuesService({ issues: createIssuesRepository(prisma), projects, events });
  const sprints = createSprintsService({ sprints: createSprintsRepository(prisma), projects, events });
  const config = createConfigService(features);
  const usersService = createUsersService(users);

  return {
    events,
    auth,
    passwords: createPasswordResetService({ users, sessions, email, logger, frontendUrl: env.CORS_ORIGIN }),
    verification: createEmailVerificationService({ users, sessions, email, logger, frontendUrl: env.CORS_ORIGIN }),
    oauth: createOAuthService({
      providers: createOAuthProviders(env, deps.fetch),
      auth,
      users,
      sessions,
      secret: env.JWT_SECRET,
      apiUrl: env.API_URL,
      logger,
    }),
    tokens: createTokensService(createTokensRepository(prisma)),
    config,
    users: usersService,
    workspace,
    invites: createInvitesService({
      workspaces,
      auth,
      users,
      email,
      logger,
      frontendUrl: env.CORS_ORIGIN,
      requireVerifiedEmail: features.email.provider !== "console",
    }),
    projects,
    issues,
    sprints,
    reports: createReportsService({ reports: createReportsRepository(prisma), sprints, projects }),
    workflow: createWorkflowService({ workflow: createWorkflowRepository(prisma), projects, events }),
    comments: createCommentsService({ comments: createCommentsRepository(prisma), issues }),
    github: createGitHubService({
      issues,
      installations: createGitHubRepository(prisma),
      workspaces,
      app:
        features.githubIntegration && env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET
          ? createGitHubAppClient({
              clientId: env.GITHUB_APP_CLIENT_ID,
              clientSecret: env.GITHUB_APP_CLIENT_SECRET,
              fetch: deps.fetch ?? fetch,
            })
          : null,
      appSlug: env.GITHUB_APP_SLUG,
      secret: env.JWT_SECRET,
      frontendUrl: env.CORS_ORIGIN,
      logger,
    }),
    bootstrap: createBootstrapService({ users: usersService, workspace, config, projects }),
  };
}

export type Services = ReturnType<typeof createServices>;
