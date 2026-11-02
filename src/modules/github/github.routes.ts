import express, { Router } from "express";
import { createGitHubController } from "./github.controller.js";
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
