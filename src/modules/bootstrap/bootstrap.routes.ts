import { Router, type RequestHandler } from "express";
import { requireScope } from "../../middleware/permissions.js";
import { authOf } from "../../middleware/require-auth.js";
import type { BootstrapService } from "./bootstrap.service.js";

/** Mounted at /bootstrap. Any role; tokens need issues:read. */
export function createBootstrapRouter(deps: { bootstrap: BootstrapService; requireAuth: RequestHandler }): Router {
  const load: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await deps.bootstrap.load(authOf(req)));
  };

  const router = Router();
  router.get("/", deps.requireAuth, requireScope("issues:read"), load);
  return router;
}
