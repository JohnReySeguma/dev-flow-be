import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { problemResponse } from "../../openapi/problem.js";
import { project } from "../projects/projects.schemas.js";
import { addStatusBody, deleteStatusQuery, reorderStatusesBody, updateStatusBody } from "./workflow.schemas.js";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const anyCaller = [{ cookieAuth: [] }, { bearerAuth: [] }];
const keyParam = z.object({ key: z.string().meta({ example: "DEV" }) });
const statusParams = keyParam.extend({ id: z.uuid() });
const updatedProject = { description: "The project with its updated workflow.", ...json(project) };

export function registerWorkflowDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "post",
    path: "/projects/{key}/statuses",
    tags: ["Workflow"],
    summary: "Add a status (board column)",
    description:
      "Admins only; tokens need projects:admin. Inserted before the first done status, unless its category is done " +
      "(then last).",
    security: anyCaller,
    request: { params: keyParam, body: json(addStatusBody) },
    responses: { 201: updatedProject, default: problemResponse },
  });
  registry.registerPath({
    method: "patch",
    path: "/projects/{key}/statuses/{id}",
    tags: ["Workflow"],
    summary: "Rename a status or change its category",
    description:
      "Admins only. Changing into or out of done sets or clears resolvedAt on its issues. 409 STATUS_UPDATE_BLOCKED " +
      "when it would leave the workflow without a to-do or done status.",
    security: anyCaller,
    request: { params: statusParams, body: json(updateStatusBody) },
    responses: { 200: updatedProject, default: problemResponse },
  });
  registry.registerPath({
    method: "put",
    path: "/projects/{key}/statuses/order",
    tags: ["Workflow"],
    summary: "Reorder the workflow",
    description: "Admins only. 422 unless statusIds lists every status of the project exactly once.",
    security: anyCaller,
    request: { params: keyParam, body: json(reorderStatusesBody) },
    responses: { 200: updatedProject, default: problemResponse },
  });
  registry.registerPath({
    method: "delete",
    path: "/projects/{key}/statuses/{id}",
    tags: ["Workflow"],
    summary: "Delete a status",
    description:
      "Admins only. Moves its issues to ?moveTo= (required when it has issues), then deletes it. 409 " +
      "STATUS_DELETE_BLOCKED keeps at least two statuses and at least one to-do and one done status.",
    security: anyCaller,
    request: { params: statusParams, query: deleteStatusQuery },
    responses: { 200: updatedProject, default: problemResponse },
  });
}
