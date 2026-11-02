import { Router, type RequestHandler } from "express";
import { requireRole, requireScope } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createSprintsController } from "./sprints.controller.js";
import { listSprintsQuery, updateSprintBody } from "./sprints.schemas.js";
import type { SprintsService } from "./sprints.service.js";

/** Every role reads; members and admins plan and run sprints. Tokens need issues:read / issues:write. */
const read = requireScope("issues:read");
const write = [requireScope("issues:write"), requireRole("member")];

/** Mounted at /projects/:key/sprints. */
export function createProjectSprintsRouter(deps: { sprints: SprintsService; requireAuth: RequestHandler }): Router {
  const controller = createSprintsController(deps.sprints);

  const router = Router({ mergeParams: true });
  router.use(deps.requireAuth);
  router.get("/", read, validate({ query: listSprintsQuery }), controller.list);
  router.post("/", ...write, controller.create);
  return router;
}

/** Mounted at /sprints. */
export function createSprintsRouter(deps: { sprints: SprintsService; requireAuth: RequestHandler }): Router {
  const controller = createSprintsController(deps.sprints);

  const router = Router();
  router.use(deps.requireAuth);
  router.patch("/:id", ...write, validate({ body: updateSprintBody }), controller.update);
  router.delete("/:id", ...write, controller.remove);
  return router;
}
