import { Router, type RequestHandler } from "express";
import { paginationQuery } from "../../lib/pagination.js";
import { validate } from "../../middleware/validate.js";
import { createTokensController } from "./tokens.controller.js";
import { createTokenBody } from "./tokens.schemas.js";
import type { TokensService } from "./tokens.service.js";

/** Mounted at /me/tokens. Session only: a token cannot list or mint other tokens. */
export function createTokensRouter(deps: {
  tokens: TokensService;
  requireAuth: RequestHandler;
  requireSession: RequestHandler;
}): Router {
  const controller = createTokensController(deps.tokens);

  const router = Router();
  router.use(deps.requireAuth, deps.requireSession);
  router.get("/", validate({ query: paginationQuery }), controller.list);
  router.post("/", validate({ body: createTokenBody }), controller.create);
  router.delete("/:id", controller.revoke);
  return router;
}
