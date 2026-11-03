import express, { Router, type RequestHandler } from "express";
import { lockedInDemoWorkspace } from "../../middleware/demo-locks.js";
import { requireRole, requireScope } from "../../middleware/permissions.js";
import { createGitHubController, createGitHubLinkController } from "./github.controller.js";
import type { GitHubService } from "./github.service.js";

/**
 * GitHub App deliveries. Mounted before express.json: the signature covers the raw bytes. Not
 * origin-checked (GitHub sends no Origin) and not authenticated; the HMAC signature is the auth.
 */
export function createGitHubRouter(deps: { github: GitHubService; secret: string | null }): Router {
  const controller = createGitHubController(deps);

  const router = Router();
  // GitHub caps payloads at 25 MB; pushes with many commits are the large ones.
  router.post("/webhook", express.raw({ type: () => true, limit: "5mb" }), controller.webhook);
  return router;
}

/**
 * Mounted at /api/integrations/github after the cookie parser: GitHub's redirect after installing
 * the App, registered as the App's callback URL. Version-free, like the webhook.
 */
export function createGitHubSetupRouter(deps: { github: GitHubService }): Router {
  const controller = createGitHubLinkController(deps.github);

  const router = Router();
  router.get("/setup", controller.setup);
  return router;
}

/** Mounted at /workspaces/:ws/integrations/github. Anyone reads; admins link and unlink. */
export function createWorkspaceGitHubRouter(deps: {
  github: GitHubService;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
}): Router {
  const controller = createGitHubLinkController(deps.github);
  const manage = [deps.requireSession, requireRole("admin"), lockedInDemoWorkspace];

  const router = Router();
  router.use(deps.requireAuth);
  router.get("/", requireScope("issues:read"), controller.status);
  router.get("/install", ...manage, controller.install);
  router.delete("/installations/:id", ...manage, controller.unlink);
  return router;
}
