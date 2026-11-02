import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { problemResponse } from "../../openapi/problem.js";
import { burndownResponse, historyQuery, historyResponse, velocityQuery, velocityResponse } from "./reports.schemas.js";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const anyCaller = [{ cookieAuth: [] }, { bearerAuth: [] }];
const projectParam = z.object({ key: z.string().meta({ example: "DEV" }) });

export function registerReportsDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/sprints/{id}/burndown",
    tags: ["Reports"],
    summary: "Burndown of a sprint",
    description:
      "One point per sprint day from the issue history: ideal falls from committedPoints to zero; remaining is the " +
      "points still open in the sprint at that moment, null for days still ahead. A completed sprint is read just " +
      "before it completed. Empty days for a sprint that has not started. Any role; tokens need issues:read.",
    security: anyCaller,
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 200: { description: "The burndown.", ...json(burndownResponse) }, default: problemResponse },
  });
  registry.registerPath({
    method: "get",
    path: "/projects/{key}/reports/velocity",
    tags: ["Reports"],
    summary: "Velocity of recent sprints",
    description: "Committed against completed points for the last `limit` completed sprints, oldest first.",
    security: anyCaller,
    request: { params: projectParam, query: velocityQuery },
    responses: { 200: { description: "The velocity series.", ...json(velocityResponse) }, default: problemResponse },
  });
  registry.registerPath({
    method: "get",
    path: "/projects/{key}/reports/history",
    tags: ["Reports"],
    summary: "Sprint history",
    description: "Completed sprints with goal, dates and report, newest first.",
    security: anyCaller,
    request: { params: projectParam, query: historyQuery },
    responses: {
      200: { description: "A page of completed sprints.", ...json(historyResponse) },
      default: problemResponse,
    },
  });
}
