import { Router, type RequestHandler } from "express";
import { validate } from "../../middleware/validate.js";
import { createUsersController } from "./users.controller.js";
import { updateProfileBody } from "./users.schemas.js";
import type { UsersService } from "./users.service.js";

/** The signed-in user's own profile, mounted at /me. Tokens may read it but not change it. */
export function createMeRouter(deps: {
  users: UsersService;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
}): Router {
  const controller = createUsersController(deps.users);

  const router = Router();
  router.get("/", deps.requireAuth, controller.getMe);
  router.patch("/", deps.requireAuth, deps.requireSession, validate({ body: updateProfileBody }), controller.updateMe);
  return router;
}
