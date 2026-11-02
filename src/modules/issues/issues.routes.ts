import { Router, type RequestHandler } from "express";
import { requireRole, requireScope } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createIssuesController } from "./issues.controller.js";
import { createIssueBody, issueLookupQuery, listIssuesQuery, updateIssueBody } from "./issues.schemas.js";
import type { IssuesService } from "./issues.service.js";

/**
 * Every role reads; members and admins write. Access tokens need issues:read to read and
 * issues:write to change issues.
 */
const read = requireScope("issues:read");
const write = [requireScope("issues:write"), requireRole("member")];

/** Mounted at /projects/:key/issues. */
export function createProjectIssuesRouter(deps: { issues: IssuesService; requireAuth: RequestHandler }): Router {
  const controller = createIssuesController(deps.issues);

  const router = Router({ mergeParams: true });
  router.use(deps.requireAuth);
  router.get("/", read, validate({ query: listIssuesQuery }), controller.list);
  router.post("/", ...write, validate({ body: createIssueBody }), controller.create);
  return router;
}

/** Mounted at /issues. */
export function createIssuesRouter(deps: { issues: IssuesService; requireAuth: RequestHandler }): Router {
  const controller = createIssuesController(deps.issues);
  const lookup = validate({ query: issueLookupQuery });

  const router = Router();
  router.use(deps.requireAuth);
  router.get("/:issueKey", read, lookup, controller.get);
  router.patch("/:issueKey", ...write, lookup, validate({ body: updateIssueBody }), controller.update);
  router.delete("/:issueKey", ...write, lookup, controller.remove);
  return router;
}
