import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import pkg from "../../package.json" with { type: "json" };
import { registerAuthDocs } from "../modules/auth/auth.openapi.js";
import { registerConfigDocs } from "../modules/config/config.openapi.js";
import { registerHealthDocs } from "../modules/health/health.openapi.js";
import { registerTokensDocs } from "../modules/tokens/tokens.openapi.js";
import { registerUsersDocs } from "../modules/users/users.openapi.js";

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

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "DevFlow API",
      version: pkg.version,
      description:
        "REST API for DevFlow, a sprint-based issue tracker. Errors use RFC 9457 problem details; " +
        "see docs/INTEGRATION.md for the error catalogue and integration contract.",
    },
    servers: [{ url: "/api/v1" }],
  });
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;

/** Stable serialisation shared by the generator and the staleness test. */
export const serializeOpenApi = (document: OpenApiDocument) => `${JSON.stringify(document, null, 2)}\n`;
