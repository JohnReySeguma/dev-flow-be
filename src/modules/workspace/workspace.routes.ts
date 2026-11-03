import { Router, type RequestHandler } from "express";
import { paginationQuery } from "../../lib/pagination.js";
import { lockedForDemoAccounts, lockedInDemoWorkspace } from "../../middleware/demo-locks.js";
import { requireRole, requireScope } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createInvitesController } from "./invites.controller.js";
import type { InvitesService } from "./invites.service.js";
import { createWorkspaceController } from "./workspace.controller.js";
import { changeRoleBody, createWorkspaceBody, inviteBody, renameWorkspaceBody } from "./workspace.schemas.js";
import type { WorkspaceService } from "./workspace.service.js";

/**
 * Mounted at /workspaces: the caller's workspaces and creating one. Signed-in sessions only:
 * an access token works in a single workspace.
 */
export function createWorkspacesRouter(deps: {
  workspace: WorkspaceService;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
  /** New workspaces per user. */
  limit: RequestHandler;
}): Router {
  const controller = createWorkspaceController(deps.workspace);

  const router = Router();
  router.get("/", deps.requireAuth, deps.requireSession, validate({ query: paginationQuery }), controller.list);
  router.post(
    "/",
    deps.requireAuth,
    deps.requireSession,
    lockedForDemoAccounts,
    deps.limit,
    validate({ body: createWorkspaceBody }),
    controller.create,
  );
  return router;
}

/** Mounted at /workspaces/:ws. Every role can read; managing members needs an admin's signed-in session. */
export function createWorkspaceRouter(deps: {
  workspace: WorkspaceService;
  invites: InvitesService;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
  /** Invite emails per workspace. */
  limitInvites: RequestHandler;
}): Router {
  const controller = createWorkspaceController(deps.workspace);
  const invites = createInvitesController(deps.invites);
  const admin = [deps.requireSession, requireRole("admin")];
  // Changes every visitor of the public demo would see.
  const manage = [...admin, lockedInDemoWorkspace];

  const router = Router();
  router.use(deps.requireAuth);
  // Tokens need issues:read, like every other read: members and invites include email addresses.
  const read = requireScope("issues:read");
  router.get("/", read, controller.get);
  router.patch("/", ...manage, validate({ body: renameWorkspaceBody }), controller.rename);
  router.delete("/", ...manage, controller.deleteWorkspace);
  router.post("/leave", deps.requireSession, lockedInDemoWorkspace, controller.leave);
  router.get("/members", read, validate({ query: paginationQuery }), controller.listMembers);
  router.patch("/members/:id", ...manage, validate({ body: changeRoleBody }), controller.changeRole);
  router.delete("/members/:id", ...manage, controller.remove);
  router.post("/invites", ...manage, deps.limitInvites, validate({ body: inviteBody }), invites.create);
  router.post("/invites/:id/resend", ...manage, deps.limitInvites, invites.resend);
  router.post("/demo/reset", ...admin, controller.resetDemo);
  return router;
}
