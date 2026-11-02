import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";
import { problemResponse } from "../../openapi/problem.js";
import { changeRoleBody, teamMember, teamMemberPage, workspaceResponse } from "./workspace.schemas.js";

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
  registry.registerPath({
    method: "patch",
    path: "/workspace/members/{id}",
    tags: ["Workspace"],
    summary: "Change a member's or invite's role",
    description:
      "Admins only, signed-in session only. Errors: 403 CANNOT_CHANGE_OWN_ROLE, 409 LAST_ADMIN (demoting the last " +
      "active admin), 404 NOT_FOUND. Last write wins: no If-Match.",
    security: [{ cookieAuth: [] }],
    request: { params: z.object({ id: z.uuid() }), body: json(changeRoleBody) },
    responses: { 200: { description: "The updated member.", ...json(teamMember) }, default: problemResponse },
  });
  registry.registerPath({
    method: "delete",
    path: "/workspace/members/{id}",
    tags: ["Workspace"],
    summary: "Remove a member or revoke an invite",
    description:
      "Admins only, signed-in session only. Removing a member deletes their account, sessions and access tokens " +
      "immediately; there is no undo. Errors: 403 CANNOT_REMOVE_SELF, 409 LAST_ADMIN, 404 NOT_FOUND.",
    security: [{ cookieAuth: [] }],
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 204: { description: "Removed." }, default: problemResponse },
  });
}
