import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { problemResponse } from "../../openapi/problem.js";
import { listSprintsQuery, sprint, sprintPage, updateSprintBody } from "./sprints.schemas.js";

export const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
export const anyCaller = [{ cookieAuth: [] }, { bearerAuth: [] }];
export const sprintParam = z.object({ id: z.uuid() });
const projectParam = z.object({ key: z.string().meta({ example: "DEV" }) });

export function registerSprintsDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/projects/{key}/sprints",
    tags: ["Sprints"],
    summary: "Sprints of a project, by number",
    description: "Any role; tokens need issues:read.",
    security: anyCaller,
    request: { params: projectParam, query: listSprintsQuery },
    responses: { 200: { description: "A page of sprints.", ...json(sprintPage) }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/projects/{key}/sprints",
    tags: ["Sprints"],
    summary: "Create the next sprint",
    description: "Members and admins; tokens need issues:write. Creates `Sprint {n+1}` in the planned state. No body.",
    security: anyCaller,
    request: { params: projectParam },
    responses: { 201: { description: "The new sprint.", ...json(sprint) }, default: problemResponse },
  });
  registry.registerPath({
    method: "patch",
    path: "/sprints/{id}",
    tags: ["Sprints"],
    summary: "Rename a sprint or set its goal",
    description: "Members and admins; tokens need issues:write.",
    security: anyCaller,
    request: { params: sprintParam, body: json(updateSprintBody) },
    responses: { 200: { description: "The updated sprint.", ...json(sprint) }, default: problemResponse },
  });
  registry.registerPath({
    method: "delete",
    path: "/sprints/{id}",
    tags: ["Sprints"],
    summary: "Delete a planned sprint",
    description:
      "Members and admins; tokens need issues:write. Its issues return to the backlog. 409 SPRINT_NOT_PLANNED for " +
      "active or completed sprints.",
    security: anyCaller,
    request: { params: sprintParam },
    responses: { 204: { description: "Deleted." }, default: problemResponse },
  });
}
