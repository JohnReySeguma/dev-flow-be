import { Router, type RequestHandler } from "express";
import { paginationQuery } from "../../lib/pagination.js";
import { requireRole, requireScope } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { issueLookupQuery } from "../issues/issues.schemas.js";
import { createCommentsController } from "./comments.controller.js";
import { createCommentBody } from "./comments.schemas.js";
import type { CommentsService } from "./comments.service.js";

/** Mounted at /issues/:issueKey/comments. Every role reads; members and admins comment. */
export function createCommentsRouter(deps: { comments: CommentsService; requireAuth: RequestHandler }): Router {
  const controller = createCommentsController(deps.comments);

  const router = Router({ mergeParams: true });
  router.use(deps.requireAuth);
  router.get(
    "/",
    requireScope("issues:read"),
    validate({ query: paginationQuery.extend(issueLookupQuery.shape) }),
    controller.list,
  );
  router.post(
    "/",
    requireScope("issues:write"),
    requireRole("member"),
    validate({ query: issueLookupQuery, body: createCommentBody }),
    controller.create,
  );
  return router;
}
