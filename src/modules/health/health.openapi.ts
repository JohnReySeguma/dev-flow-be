import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { problemResponse } from "../../openapi/problem.js";
import { livenessResponse, readinessResponse } from "./health.schemas.js";

export function registerHealthDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["Operational"],
    summary: "Liveness",
    description: "Answers as long as the process is up. Used by the Docker HEALTHCHECK.",
    responses: {
      200: { description: "The process is alive.", content: { "application/json": { schema: livenessResponse } } },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/health/ready",
    tags: ["Operational"],
    summary: "Readiness",
    description: "Checks the database, and Redis when REDIS_URL is set.",
    responses: {
      200: { description: "Ready to serve traffic.", content: { "application/json": { schema: readinessResponse } } },
      503: {
        description: "A configured dependency is down.",
        content: {
          "application/json": {
            schema: readinessResponse,
            example: { status: "unavailable", checks: { database: "down", redis: "up" } },
          },
        },
      },
      default: problemResponse,
    },
  });
}
