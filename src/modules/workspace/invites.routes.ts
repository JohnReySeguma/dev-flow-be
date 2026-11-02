import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { createInvitesController } from "./invites.controller.js";
import type { InvitesService } from "./invites.service.js";
import { acceptInviteBody } from "./workspace.schemas.js";

/** Mounted at /invites. Public: the emailed token is the credential. */
export function createInviteAcceptRouter(deps: { invites: InvitesService }): Router {
  const controller = createInvitesController(deps.invites);

  const router = Router();
  router.get("/:token", controller.preview);
  router.post("/:token/accept", validate({ body: acceptInviteBody }), controller.accept);
  return router;
}
