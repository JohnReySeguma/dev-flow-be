import { Router, type RequestHandler } from "express";
import { lockedForDemoAccounts } from "../../middleware/demo-locks.js";
import { validate } from "../../middleware/validate.js";
import { createInvitesController } from "./invites.controller.js";
import type { InvitesService } from "./invites.service.js";
import { acceptInviteBody } from "./workspace.schemas.js";

/**
 * Mounted at /invites. Preview and accept are public: the emailed token is the credential. Joining
 * with an existing account also needs that account's signed-in session.
 */
export function createInviteAcceptRouter(deps: {
  invites: InvitesService;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
}): Router {
  const controller = createInvitesController(deps.invites);

  const router = Router();
  router.get("/:token", controller.preview);
  router.post("/:token/accept", validate({ body: acceptInviteBody }), controller.accept);
  router.post("/:token/join", deps.requireAuth, deps.requireSession, lockedForDemoAccounts, controller.join);
  return router;
}
