import { Router, type RequestHandler } from "express";
import { paginationQuery } from "../../lib/pagination.js";
import { requireRole, requireScope } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createProjectsController } from "./projects.controller.js";
import { createProjectBody, updateProjectBody } from "./projects.schemas.js";
import type { ProjectsService } from "./projects.service.js";

/**
 * Mounted at /projects. Every role reads; members create and edit; admins delete.
 * Access tokens need issues:read to read and projects:admin to change projects.
 */
export function createProjectsRouter(deps: { projects: ProjectsService; requireAuth: RequestHandler }): Router {
  const controller = createProjectsController(deps.projects);
  const read = requireScope("issues:read");
  const manage = requireScope("projects:admin");

  const router = Router();
  router.use(deps.requireAuth);
  router.get("/", read, validate({ query: paginationQuery }), controller.list);
  router.post("/", manage, requireRole("member"), validate({ body: createProjectBody }), controller.create);
  router.get("/:key", read, controller.get);
  router.get("/:key/snapshot", read, controller.snapshot);
  router.patch("/:key", manage, requireRole("member"), validate({ body: updateProjectBody }), controller.update);
  router.delete("/:key", manage, requireRole("admin"), controller.remove);
  return router;
}
