import { Router, type RequestHandler } from "express";
import { requireRole, requireScope } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createWorkflowController } from "./workflow.controller.js";
import { addStatusBody, deleteStatusQuery, reorderStatusesBody, updateStatusBody } from "./workflow.schemas.js";
import type { WorkflowService } from "./workflow.service.js";

/** Mounted at /projects/:key/statuses. Admins only; access tokens need projects:admin. */
export function createWorkflowRouter(deps: { workflow: WorkflowService; requireAuth: RequestHandler }): Router {
  const controller = createWorkflowController(deps.workflow);

  const router = Router({ mergeParams: true });
  router.use(deps.requireAuth, requireScope("projects:admin"), requireRole("admin"));
  router.post("/", validate({ body: addStatusBody }), controller.add);
  // Registered before /:id so "order" is never read as a status id.
  router.put("/order", validate({ body: reorderStatusesBody }), controller.reorder);
  router.patch("/:id", validate({ body: updateStatusBody }), controller.update);
  router.delete("/:id", validate({ query: deleteStatusQuery }), controller.remove);
  return router;
}
