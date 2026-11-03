import { Router, type RequestHandler } from "express";
import { validate } from "../../middleware/validate.js";
import { createAuthController } from "./auth.controller.js";
import { forgotPasswordBody, loginBody, resetPasswordBody, signupBody, verifyEmailBody } from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";
import type { EmailVerificationService } from "./email-verification.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { PasswordResetService } from "./password-reset.service.js";

type AuthRouterDeps = {
  auth: AuthService;
  passwords: PasswordResetService;
  verification: EmailVerificationService;
  oauth: OAuthService;
  frontendUrl: string;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
};

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const controller = createAuthController(deps);

  const router = Router();
  router.post("/signup", validate({ body: signupBody }), controller.signup);
  router.post("/login", validate({ body: loginBody }), controller.login);
  router.post("/refresh", controller.refresh);
  router.post("/logout", controller.logout);
  router.post("/password/forgot", validate({ body: forgotPasswordBody }), controller.forgotPassword);
  router.post("/password/reset", validate({ body: resetPasswordBody }), controller.resetPassword);
  router.post("/email/verify", validate({ body: verifyEmailBody }), controller.verifyEmail);
  router.post("/email/resend", deps.requireAuth, deps.requireSession, controller.resendVerification);
  router.get("/oauth/:provider", controller.startOAuth);
  router.get("/me", deps.requireAuth, controller.me);
  return router;
}

/** Mounted at /api/auth/oauth, outside the versioned prefix: the URL registered with the providers. */
export function createOAuthCallbackRouter(deps: AuthRouterDeps): Router {
  const controller = createAuthController(deps);

  const router = Router();
  router.get("/:provider/callback", controller.finishOAuth);
  return router;
}
