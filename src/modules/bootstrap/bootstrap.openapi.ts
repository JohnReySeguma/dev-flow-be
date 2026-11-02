import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { problemResponse } from "../../openapi/problem.js";
import { bootstrapResponse } from "./bootstrap.schemas.js";

export function registerBootstrapDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/bootstrap",
    tags: ["Bootstrap"],
    summary: "Everything the app shell needs after sign-in",
    description:
      "The signed-in user, the workspace with your role, the feature flags and every project with its summary, in " +
      "one call. Any role; tokens need issues:read.",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    responses: {
      200: { description: "The bootstrap payload.", content: { "application/json": { schema: bootstrapResponse } } },
      default: problemResponse,
    },
  });
}
