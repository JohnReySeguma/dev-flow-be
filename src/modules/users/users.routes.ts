import { Router, type RequestHandler } from "express";
import { validate } from "../../middleware/validate.js";
import { createUsersController } from "./users.controller.js";
import { updateProfileBody } from "./users.schemas.js";
import type { UsersService } from "./users.service.js";

/** The signed-in user's own profile, mounted at /me. */
export function createMeRouter(deps: { users: UsersService; requireAuth: RequestHandler }): Router {
  const controller = createUsersController(deps.users);

  const router = Router();
  router.use(deps.requireAuth);
  router.get("/", controller.getMe);
  router.patch("/", validate({ body: updateProfileBody }), controller.updateMe);
  return router;
}
