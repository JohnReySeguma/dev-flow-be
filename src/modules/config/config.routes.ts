import { Router } from "express";
import { createConfigController } from "./config.controller.js";
import type { ConfigService } from "./config.service.js";

/** Public, unauthenticated: the sign-in page needs it before anyone has a session. */
export function createConfigRouter(deps: { config: ConfigService }): Router {
  const controller = createConfigController(deps.config);

  const router = Router();
  router.get("/", controller.get);
  return router;
}
