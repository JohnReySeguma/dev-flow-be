import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { problemResponse } from "../../openapi/problem.js";
import {
  createIssueBody,
  issue,
  issueLookupQuery,
  issuePage,
  listIssuesQuery,
  moveIssueBody,
  updateIssueBody,
} from "./issues.schemas.js";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const anyCaller = [{ cookieAuth: [] }, { bearerAuth: [] }];
const projectParam = z.object({ key: z.string().meta({ example: "DEV" }) });
const issueParam = z.object({
  issueKey: z.string().meta({ description: "DEV-104 (any case), or 104 with ?project=DEV.", example: "DEV-104" }),
});
const etagHeader = {
  ETag: { description: "Version of the issue; send it back as If-Match.", schema: { type: "string" as const } },
};

export function registerIssuesDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/projects/{key}/issues",
    tags: ["Issues"],
    summary: "Issues of a project, in rank order",
    description: "Any role; tokens need issues:read. Filters combine with AND.",
    security: anyCaller,
    request: { params: projectParam, query: listIssuesQuery },
    responses: { 200: { description: "A page of issues.", ...json(issuePage) }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/projects/{key}/issues",
    tags: ["Issues"],
    summary: "Create an issue",
    description:
      "Members and admins; tokens need issues:write. Gets the next key (DEV-134) atomically and goes to the top of " +
      "the ranking. statusId defaults to the first to-do status. sprintId must be a planned or active sprint of the " +
      "project; assigneeId a workspace member.",
    security: anyCaller,
    request: { params: projectParam, body: json(createIssueBody) },
    responses: {
      201: { description: "The new issue.", headers: etagHeader, ...json(issue) },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/issues/{issueKey}",
    tags: ["Issues"],
    summary: "An issue by key",
    description: "Any role; tokens need issues:read. A bare number needs ?project=KEY (422 otherwise).",
    security: anyCaller,
    request: { params: issueParam, query: issueLookupQuery },
    responses: { 200: { description: "The issue.", headers: etagHeader, ...json(issue) }, default: problemResponse },
  });
  registry.registerPath({
    method: "patch",
    path: "/issues/{issueKey}",
    tags: ["Issues"],
    summary: "Update an issue",
    description:
      "Members and admins; tokens need issues:write. Moving into a done-category status sets resolvedAt; moving out " +
      "clears it. Optional If-Match → 412 CONFLICT_STALE. For board drops and ranking use POST /issues/{issueKey}/move.",
    security: anyCaller,
    request: {
      params: issueParam,
      query: issueLookupQuery,
      headers: z.object({ "If-Match": z.string().optional() }),
      body: json(updateIssueBody),
    },
    responses: {
      200: { description: "The updated issue.", headers: etagHeader, ...json(issue) },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/issues/{issueKey}/move",
    tags: ["Issues"],
    summary: "Move an issue (board drop, backlog drag, ranking)",
    description:
      "Members and admins; tokens need issues:write. Changes statusId and/or sprintId and re-ranks the issue " +
      "without renumbering others. Placement rules: see MoveIssueRequest.",
    security: anyCaller,
    request: { params: issueParam, query: issueLookupQuery, body: json(moveIssueBody) },
    responses: {
      200: { description: "The moved issue.", headers: etagHeader, ...json(issue) },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "delete",
    path: "/issues/{issueKey}",
    tags: ["Issues"],
    summary: "Delete an issue",
    description: "Members and admins; tokens need issues:write. Its number is not reused.",
    security: anyCaller,
    request: { params: issueParam, query: issueLookupQuery },
    responses: { 204: { description: "Deleted." }, default: problemResponse },
  });
}
