import { Router, type RequestHandler } from "express";
import { validate } from "../../middleware/validate.js";
import { createAuthController } from "./auth.controller.js";
import { loginBody, signupBody } from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";

export function createAuthRouter(deps: { auth: AuthService; requireAuth: RequestHandler }): Router {
  const controller = createAuthController(deps.auth);

  const router = Router();
  router.post("/signup", validate({ body: signupBody }), controller.signup);
  router.post("/login", validate({ body: loginBody }), controller.login);
  router.post("/logout", controller.logout);
  router.get("/me", deps.requireAuth, controller.me);
  return router;
}
