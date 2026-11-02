import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { problemResponse } from "../../openapi/problem.js";
import { publicConfigResponse } from "./config.schemas.js";

export function registerConfigDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/config",
    tags: ["Config"],
    summary: "Enabled optional features",
    description: "No authentication. Lets the frontend hide sign-in options and integrations that are not configured.",
    responses: {
      200: { description: "Feature flags.", content: { "application/json": { schema: publicConfigResponse } } },
      default: problemResponse,
    },
  });
}
