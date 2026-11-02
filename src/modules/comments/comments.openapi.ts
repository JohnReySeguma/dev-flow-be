import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";
import { problemResponse } from "../../openapi/problem.js";
import { issueLookupQuery } from "../issues/issues.schemas.js";
import { comment, commentPage, createCommentBody } from "./comments.schemas.js";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const anyCaller = [{ cookieAuth: [] }, { bearerAuth: [] }];
const issueParam = z.object({ issueKey: z.string().meta({ example: "DEV-104" }) });

export function registerCommentsDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/issues/{issueKey}/comments",
    tags: ["Comments"],
    summary: "An issue's comment thread",
    description: "Oldest first. Any role; tokens need issues:read.",
    security: anyCaller,
    request: { params: issueParam, query: paginationQuery.extend(issueLookupQuery.shape) },
    responses: { 200: { description: "A page of comments.", ...json(commentPage) }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/issues/{issueKey}/comments",
    tags: ["Comments"],
    summary: "Comment on an issue",
    description:
      "Members and admins; tokens need issues:write. The body is Markdown, stored as written; sanitise it when " +
      "rendering. Increments the issue's comments count.",
    security: anyCaller,
    request: { params: issueParam, query: issueLookupQuery, body: json(createCommentBody) },
    responses: { 201: { description: "The new comment.", ...json(comment) }, default: problemResponse },
  });
}
