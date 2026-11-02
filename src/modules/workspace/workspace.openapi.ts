import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { paginationQuery } from "../../lib/pagination.js";
import { problemResponse } from "../../openapi/problem.js";
import { teamMemberPage, workspaceResponse } from "./workspace.schemas.js";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const anyCaller = [{ cookieAuth: [] }, { bearerAuth: [] }];

export function registerWorkspaceDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/workspace",
    tags: ["Workspace"],
    summary: "The workspace and your role in it",
    security: anyCaller,
    responses: { 200: { description: "The workspace.", ...json(workspaceResponse) }, default: problemResponse },
  });
  registry.registerPath({
    method: "get",
    path: "/workspace/members",
    tags: ["Workspace"],
    summary: "Members and pending invites",
    description: "Oldest first. Pending invites have status `invited` and lastActiveAt null. Any role.",
    security: anyCaller,
    request: { query: paginationQuery },
    responses: { 200: { description: "A page of members.", ...json(teamMemberPage) }, default: problemResponse },
  });
}
