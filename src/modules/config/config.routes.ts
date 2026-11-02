import { Router } from "express";
import type { Features } from "../../config/features.js";
import { createConfigController } from "./config.controller.js";
import { createConfigService } from "./config.service.js";

/** Public, unauthenticated: the sign-in page needs it before anyone has a session. */
export function createConfigRouter(deps: { features: Features }): Router {
  const controller = createConfigController(createConfigService(deps.features));

  const router = Router();
  router.get("/", controller.get);
  return router;
}
