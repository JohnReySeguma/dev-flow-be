import { Router, type RequestHandler } from "express";
import { paginationQuery } from "../../lib/pagination.js";
import { validate } from "../../middleware/validate.js";
import { createWorkspaceController } from "./workspace.controller.js";
import type { WorkspaceService } from "./workspace.service.js";

/** Mounted at /workspace. Every role can read the workspace and its members. */
export function createWorkspaceRouter(deps: { workspace: WorkspaceService; requireAuth: RequestHandler }): Router {
  const controller = createWorkspaceController(deps.workspace);

  const router = Router();
  router.use(deps.requireAuth);
  router.get("/", controller.get);
  router.get("/members", validate({ query: paginationQuery }), controller.listMembers);
  return router;
}
