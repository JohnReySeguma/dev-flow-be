import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";
import { problemResponse } from "../../openapi/problem.js";
import { authMeResponse } from "../auth/auth.schemas.js";
import {
  acceptInviteBody,
  changeRoleBody,
  createWorkspaceBody,
  inviteBody,
  invitePreviewResponse,
  teamMember,
  renameWorkspaceBody,
  teamMemberPage,
  workspacePage,
  workspaceResponse,
} from "./workspace.schemas.js";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const anyCaller = [{ cookieAuth: [] }, { bearerAuth: [] }];

/** `workspace` registers under /workspaces/{workspace}; the invite links are global. */
export function registerWorkspaceDocs(registry: OpenAPIRegistry, workspace: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/workspaces",
    tags: ["Workspace"],
    summary: "Your workspaces",
    description:
      "Every workspace you belong to, with your role in each, oldest membership first (GET /auth/me has the " +
      "same list unpaginated). Signed-in session only.",
    security: [{ cookieAuth: [] }],
    request: { query: paginationQuery },
    responses: { 200: { description: "A page of workspaces.", ...json(workspacePage) }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/workspaces",
    tags: ["Workspace"],
    summary: "Create a workspace",
    description:
      "You become its admin. With sampleData (the default) it starts with a copy of the sample projects DEV, BIL " +
      "and MOB: the demo admin's issues are yours, the rest unassigned, no comments. The slug comes from the name " +
      "and gets a short suffix when taken. Signed-in session only. 403 DEMO_ACCOUNT_LOCKED for the shared demo accounts.",
    security: [{ cookieAuth: [] }],
    request: { body: json(createWorkspaceBody) },
    responses: { 201: { description: "The new workspace.", ...json(workspaceResponse) }, default: problemResponse },
  });
  workspace.registerPath({
    method: "get",
    path: "/",
    tags: ["Workspace"],
    summary: "The workspace and your role in it",
    description: "404 NOT_FOUND when you are not a member, exactly as for a workspace that does not exist.",
    security: anyCaller,
    responses: { 200: { description: "The workspace.", ...json(workspaceResponse) }, default: problemResponse },
  });
  workspace.registerPath({
    method: "patch",
    path: "/",
    tags: ["Workspace"],
    summary: "Rename the workspace",
    description:
      "Admins only, signed-in session only. The slug does not change, so links keep working. 403 DEMO_WORKSPACE_LOCKED in the demo workspace.",
    security: [{ cookieAuth: [] }],
    request: { body: json(renameWorkspaceBody) },
    responses: { 200: { description: "The renamed workspace.", ...json(workspaceResponse) }, default: problemResponse },
  });
  workspace.registerPath({
    method: "delete",
    path: "/",
    tags: ["Workspace"],
    summary: "Delete the workspace",
    description:
      "Admins only, signed-in session only. Deletes its projects, issues, sprints, invites and access tokens, and " +
      "every membership, immediately; there is no undo. The accounts themselves are kept. 403 DEMO_WORKSPACE_LOCKED in the demo workspace.",
    security: [{ cookieAuth: [] }],
    responses: { 204: { description: "Deleted." }, default: problemResponse },
  });
  workspace.registerPath({
    method: "post",
    path: "/leave",
    tags: ["Workspace"],
    summary: "Leave the workspace",
    description:
      "Any role, signed-in session only. Your access tokens for it are deleted and your issues and project leads " +
      "in it are unassigned. 409 LAST_ADMIN when you are its last admin: promote someone first, or delete the " +
      "workspace if you are its only member. 403 DEMO_WORKSPACE_LOCKED in the demo workspace.",
    security: [{ cookieAuth: [] }],
    responses: { 204: { description: "Left." }, default: problemResponse },
  });
  workspace.registerPath({
    method: "get",
    path: "/members",
    tags: ["Workspace"],
    summary: "Members and pending invites",
    description: "Oldest first. Pending invites have status `invited` and lastActiveAt null. Any role.",
    security: anyCaller,
    request: { query: paginationQuery },
    responses: { 200: { description: "A page of members.", ...json(teamMemberPage) }, default: problemResponse },
  });
  workspace.registerPath({
    method: "patch",
    path: "/members/{id}",
    tags: ["Workspace"],
    summary: "Change a member's or invite's role",
    description:
      "Admins only, signed-in session only. Errors: 403 CANNOT_CHANGE_OWN_ROLE, 409 LAST_ADMIN (demoting the last " +
      "active admin), 404 NOT_FOUND. Last write wins: no If-Match. 403 DEMO_WORKSPACE_LOCKED in the demo workspace.",
    security: [{ cookieAuth: [] }],
    request: { params: z.object({ id: z.uuid() }), body: json(changeRoleBody) },
    responses: { 200: { description: "The updated member.", ...json(teamMember) }, default: problemResponse },
  });
  workspace.registerPath({
    method: "delete",
    path: "/members/{id}",
    tags: ["Workspace"],
    summary: "Remove a member or revoke an invite",
    description:
      "Admins only, signed-in session only. Removing a member deletes their account, sessions and access tokens " +
      "immediately; there is no undo. Errors: 403 CANNOT_REMOVE_SELF, 409 LAST_ADMIN, 404 NOT_FOUND. 403 DEMO_WORKSPACE_LOCKED in the demo workspace.",
    security: [{ cookieAuth: [] }],
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 204: { description: "Removed." }, default: problemResponse },
  });
  workspace.registerPath({
    method: "post",
    path: "/invites",
    tags: ["Workspace"],
    summary: "Invite someone by email",
    description:
      "Admins only, signed-in session only. Emails a single-use link to {CORS_ORIGIN}/invite?token=… that expires " +
      "after 7 days. Errors: 409 ALREADY_MEMBER (already a member or already invited), 502 EMAIL_DELIVERY_FAILED " +
      "(the invite is kept; use resend). 403 DEMO_WORKSPACE_LOCKED in the demo workspace.",
    security: [{ cookieAuth: [] }],
    request: { body: json(inviteBody) },
    responses: { 201: { description: "The pending invite.", ...json(teamMember) }, default: problemResponse },
  });
  workspace.registerPath({
    method: "post",
    path: "/invites/{id}/resend",
    tags: ["Workspace"],
    summary: "Re-send an invite",
    description:
      "Admins only. Sends a new link valid for 7 days; earlier links stop working. 404 NOT_FOUND if the invite " +
      "was accepted or revoked; 502 EMAIL_DELIVERY_FAILED. 403 DEMO_WORKSPACE_LOCKED in the demo workspace.",
    security: [{ cookieAuth: [] }],
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 200: { description: "The pending invite.", ...json(teamMember) }, default: problemResponse },
  });
  workspace.registerPath({
    method: "post",
    path: "/demo/reset",
    tags: ["Workspace"],
    summary: "Restore the demo projects",
    description:
      "Admins only, signed-in session only. Replaces every project, sprint and issue with a fresh copy of the demo " +
      "data (DEV, BIL, MOB), dated relative to now; accounts are untouched. 404 NOT_FOUND unless the server runs " +
      "with SEED_DEMO_DATA=true. Re-fetch /bootstrap afterwards.",
    security: [{ cookieAuth: [] }],
    responses: { 204: { description: "Demo data restored." }, default: problemResponse },
  });
  registry.registerPath({
    method: "get",
    path: "/invites/{token}",
    tags: ["Invites"],
    summary: "Preview an invite",
    description:
      "Public; for the /invite page. 400 INVITE_INVALID when the link is unknown, already used, replaced by a " +
      "resend or expired.",
    request: { params: z.object({ token: z.string() }) },
    responses: { 200: { description: "The invite.", ...json(invitePreviewResponse) }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/invites/{token}/accept",
    tags: ["Invites"],
    summary: "Accept an invite",
    description:
      "Public. Creates the account for the invited email with the invited role and signs it in (session cookies). " +
      "Errors: 400 INVITE_INVALID, 409 ALREADY_MEMBER (the email already has an account: sign in instead), " +
      "422 VALIDATION_FAILED.",
    request: { params: z.object({ token: z.string() }), body: json(acceptInviteBody) },
    responses: {
      201: {
        description: "Account created and signed in.",
        headers: {
          "Set-Cookie": { description: "The session cookies, as for /auth/login.", schema: { type: "string" } },
        },
        ...json(authMeResponse),
      },
      default: problemResponse,
    },
  });
}
