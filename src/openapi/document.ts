import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import pkg from "../../package.json" with { type: "json" };
import { registerConfigDocs } from "../modules/config/config.openapi.js";
import { registerHealthDocs } from "../modules/health/health.openapi.js";

/** Assembles the OpenAPI 3.1 document from every module's Zod schemas. */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registerHealthDocs(registry);
  registerConfigDocs(registry);

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
