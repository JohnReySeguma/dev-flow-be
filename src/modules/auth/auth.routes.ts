import { Router, type RequestHandler } from "express";
import { validate } from "../../middleware/validate.js";
import { createAuthController } from "./auth.controller.js";
import { forgotPasswordBody, loginBody, resetPasswordBody, signupBody } from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { PasswordResetService } from "./password-reset.service.js";

export function createAuthRouter(deps: {
  auth: AuthService;
  passwords: PasswordResetService;
  oauth: OAuthService;
  frontendUrl: string;
  requireAuth: RequestHandler;
}): Router {
  const controller = createAuthController(deps);

  const router = Router();
  router.post("/signup", validate({ body: signupBody }), controller.signup);
  router.post("/login", validate({ body: loginBody }), controller.login);
  router.post("/refresh", controller.refresh);
  router.post("/logout", controller.logout);
  router.post("/password/forgot", validate({ body: forgotPasswordBody }), controller.forgotPassword);
  router.post("/password/reset", validate({ body: resetPasswordBody }), controller.resetPassword);
  router.get("/oauth/:provider", controller.startOAuth);
  router.get("/oauth/:provider/callback", controller.finishOAuth);
  router.get("/me", deps.requireAuth, controller.me);
  return router;
}
