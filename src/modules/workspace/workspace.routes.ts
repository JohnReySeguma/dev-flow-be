import { Router, type RequestHandler } from "express";
import { paginationQuery } from "../../lib/pagination.js";
import { requireRole, requireScope } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createInvitesController } from "./invites.controller.js";
import type { InvitesService } from "./invites.service.js";
import { createWorkspaceController } from "./workspace.controller.js";
import { changeRoleBody, inviteBody } from "./workspace.schemas.js";
import type { WorkspaceService } from "./workspace.service.js";

/** Mounted at /workspaces/:ws. Every role can read; managing members needs an admin's signed-in session. */
export function createWorkspaceRouter(deps: {
  workspace: WorkspaceService;
  invites: InvitesService;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
}): Router {
  const controller = createWorkspaceController(deps.workspace);
  const invites = createInvitesController(deps.invites);
  const admin = [deps.requireSession, requireRole("admin")];

  const router = Router();
  router.use(deps.requireAuth);
  // Tokens need issues:read, like every other read: members and invites include email addresses.
  const read = requireScope("issues:read");
  router.get("/", read, controller.get);
  router.get("/members", read, validate({ query: paginationQuery }), controller.listMembers);
  router.patch("/members/:id", ...admin, validate({ body: changeRoleBody }), controller.changeRole);
  router.delete("/members/:id", ...admin, controller.remove);
  router.post("/invites", ...admin, validate({ body: inviteBody }), invites.create);
  router.post("/invites/:id/resend", ...admin, invites.resend);
  router.post("/demo/reset", ...admin, controller.resetDemo);
  return router;
}
