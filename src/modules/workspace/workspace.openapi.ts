import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";
import { problemResponse } from "../../openapi/problem.js";
import { changeRoleBody, inviteBody, teamMember, teamMemberPage, workspaceResponse } from "./workspace.schemas.js";

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
  registry.registerPath({
    method: "post",
    path: "/workspace/invites",
    tags: ["Workspace"],
    summary: "Invite someone by email",
    description:
      "Admins only, signed-in session only. Emails a single-use link to {CORS_ORIGIN}/invite?token=… that expires " +
      "after 7 days. Errors: 409 ALREADY_MEMBER (already a member or already invited), 502 EMAIL_DELIVERY_FAILED " +
      "(the invite is kept; use resend).",
    security: [{ cookieAuth: [] }],
    request: { body: json(inviteBody) },
    responses: { 201: { description: "The pending invite.", ...json(teamMember) }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/workspace/invites/{id}/resend",
    tags: ["Workspace"],
    summary: "Re-send an invite",
    description:
      "Admins only. Sends a new link valid for 7 days; earlier links stop working. 404 NOT_FOUND if the invite " +
      "was accepted or revoked; 502 EMAIL_DELIVERY_FAILED.",
    security: [{ cookieAuth: [] }],
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 200: { description: "The pending invite.", ...json(teamMember) }, default: problemResponse },
  });
}
