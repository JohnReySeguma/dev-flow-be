import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import pkg from "../../package.json" with { type: "json" };
import { registerAuthDocs } from "../modules/auth/auth.openapi.js";
import { registerBootstrapDocs } from "../modules/bootstrap/bootstrap.openapi.js";
import { registerCommentsDocs } from "../modules/comments/comments.openapi.js";
import { registerConfigDocs } from "../modules/config/config.openapi.js";
import { registerGitHubDocs } from "../modules/github/github.openapi.js";
import { registerHealthDocs } from "../modules/health/health.openapi.js";
import { registerIssuesDocs } from "../modules/issues/issues.openapi.js";
import { registerProjectsDocs } from "../modules/projects/projects.openapi.js";
import { registerReportsDocs } from "../modules/reports/reports.openapi.js";
import { registerSprintsDocs } from "../modules/sprints/sprints.openapi.js";
import { registerTokensDocs } from "../modules/tokens/tokens.openapi.js";
import { registerUsersDocs } from "../modules/users/users.openapi.js";
import { registerWorkflowDocs } from "../modules/workflow/workflow.openapi.js";
import { registerWorkspaceDocs } from "../modules/workspace/workspace.openapi.js";

/** Assembles the OpenAPI 3.1 document from every module's Zod schemas. */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "devflow_access",
    description: "Session cookie set by /auth/login, /auth/signup and OAuth. Send requests with credentials.",
  });

  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Personal access token (dfp_…) from POST /me/tokens, for the CLI and scripts.",
  });

  registerHealthDocs(registry);
  registerConfigDocs(registry);
  registerAuthDocs(registry);
  registerUsersDocs(registry);
  registerTokensDocs(registry);
  registerWorkspaceDocs(registry);
  registerProjectsDocs(registry);
  registerIssuesDocs(registry);
  registerWorkflowDocs(registry);
  registerCommentsDocs(registry);
  registerSprintsDocs(registry);
  registerReportsDocs(registry);
  registerBootstrapDocs(registry);
  registerGitHubDocs(registry);

  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "DevFlow API",
      version: pkg.version,
      description:
        "REST API for DevFlow, a sprint-based issue tracker. Errors use RFC 9457 problem details; " +
        "see docs/INTEGRATION.md for the error catalogue and integration contract. Every endpoint except " +
        "the health checks is rate-limited per client and answers 429 RATE_LIMITED with Retry-After when " +
        "a limit is reached (limits: docs/INTEGRATION.md §4.1).",
    },
    servers: [{ url: "/api/v2" }],
  });
  addRateLimitResponses(document);
  for (const path of PROVIDER_PATHS) {
    const item = (document.paths as Record<string, { servers?: unknown }> | undefined)?.[path];
    if (item) item.servers = [{ url: "/api", description: "Version-free: the URL registered with the provider." }];
  }
  return document;
}

/** Served under /api instead of /api/v2 (app.ts PROVIDER_PREFIX). */
const PROVIDER_PATHS = ["/auth/oauth/{provider}/callback", "/integrations/github/webhook"];

const HTTP_METHODS = ["get", "put", "post", "delete", "patch"] as const;

/** middleware/rate-limit.ts covers every route except the health checks; say so on each operation. */
function addRateLimitResponses(document: { paths?: Record<string, object> }) {
  const tooMany = {
    description: "RATE_LIMITED: too many requests from this client. Retry after Retry-After seconds.",
    headers: {
      "Retry-After": { description: "Seconds until the limit resets.", schema: { type: "integer" } },
      RateLimit: { description: "Remaining quota (IETF draft-7 RateLimit header).", schema: { type: "string" } },
    },
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
  };
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (path.startsWith("/health")) continue;
    for (const method of HTTP_METHODS) {
      const operation = (item as Partial<Record<string, { responses?: Record<string, unknown> }>>)[method];
      if (operation?.responses) operation.responses["429"] = tooMany;
    }
  }
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;

/** Stable serialisation shared by the generator and the staleness test. */
export const serializeOpenApi = (document: OpenApiDocument) => `${JSON.stringify(document, null, 2)}\n`;
