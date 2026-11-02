import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";
import { problemResponse } from "../../openapi/problem.js";
import { createProjectBody, project, projectPage, updateProjectBody } from "./projects.schemas.js";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const anyCaller = [{ cookieAuth: [] }, { bearerAuth: [] }];
const keyParam = z.object({ key: z.string().meta({ description: "Project key, any case.", example: "DEV" }) });
const etagHeader = {
  ETag: { description: "Version of the project; send it back as If-Match.", schema: { type: "string" as const } },
};

export function registerProjectsDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/projects",
    tags: ["Projects"],
    summary: "Projects in the workspace",
    description: "Oldest first. Any role; tokens need issues:read.",
    security: anyCaller,
    request: { query: paginationQuery },
    responses: { 200: { description: "A page of projects.", ...json(projectPage) }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/projects",
    tags: ["Projects"],
    summary: "Create a project",
    description:
      "Members and admins; tokens need projects:admin. The key is upper-cased, must match ^[A-Z]{2,5}$ and cannot " +
      "change later. Creates the default workflow (To Do, In Progress, In Review, Done); the creator leads the " +
      "project. Errors: 409 PROJECT_KEY_TAKEN, 422 VALIDATION_FAILED.",
    security: anyCaller,
    request: { body: json(createProjectBody) },
    responses: {
      201: { description: "The new project.", headers: etagHeader, ...json(project) },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/projects/{key}",
    tags: ["Projects"],
    summary: "A project with its workflow",
    security: anyCaller,
    request: { params: keyParam },
    responses: {
      200: { description: "The project.", headers: etagHeader, ...json(project) },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "patch",
    path: "/projects/{key}",
    tags: ["Projects"],
    summary: "Rename or describe a project",
    description:
      "Members and admins; tokens need projects:admin. The key is immutable. Optional If-Match → 412 CONFLICT_STALE.",
    security: anyCaller,
    request: {
      params: keyParam,
      headers: z.object({ "If-Match": z.string().optional() }),
      body: json(updateProjectBody),
    },
    responses: {
      200: { description: "The updated project.", headers: etagHeader, ...json(project) },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "delete",
    path: "/projects/{key}",
    tags: ["Projects"],
    summary: "Delete a project",
    description: "Admins only; tokens need projects:admin. Deletes its workflow, sprints, issues and comments.",
    security: anyCaller,
    request: { params: keyParam },
    responses: { 204: { description: "Deleted." }, default: problemResponse },
  });
}
