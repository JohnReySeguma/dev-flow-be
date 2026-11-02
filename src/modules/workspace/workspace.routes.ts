import { Router, type RequestHandler } from "express";
import { paginationQuery } from "../../lib/pagination.js";
import { requireRole } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createWorkspaceController } from "./workspace.controller.js";
import { changeRoleBody } from "./workspace.schemas.js";
import type { WorkspaceService } from "./workspace.service.js";

/** Mounted at /workspace. Every role can read; managing members needs an admin's signed-in session. */
export function createWorkspaceRouter(deps: {
  workspace: WorkspaceService;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
}): Router {
  const controller = createWorkspaceController(deps.workspace);
  const admin = [deps.requireSession, requireRole("admin")];

  const router = Router();
  router.use(deps.requireAuth);
  router.get("/", controller.get);
  router.get("/members", validate({ query: paginationQuery }), controller.listMembers);
  router.patch("/members/:id", ...admin, validate({ body: changeRoleBody }), controller.changeRole);
  router.delete("/members/:id", ...admin, controller.remove);
  return router;
}
