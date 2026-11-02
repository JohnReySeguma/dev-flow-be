import type { Request, RequestHandler } from "express";
import type { PaginationQuery } from "../../lib/pagination.js";
import { authOf } from "../../middleware/require-auth.js";
import type { CreateCommentInput } from "./comments.schemas.js";
import type { CommentsService } from "./comments.service.js";

// validate({ query }) has already replaced req.query with the parsed value.
const query = (req: Request) => req.query as unknown as PaginationQuery & { project?: string };
const issueKeyOf = (req: Request) => String(req.params.issueKey);

export function createCommentsController(comments: CommentsService) {
  const list: RequestHandler = async (req, res) => {
    const { project, ...page } = query(req);
    res.set("Cache-Control", "no-store").json(await comments.list(authOf(req), issueKeyOf(req), page, project));
  };

  const create: RequestHandler = async (req, res) => {
    res
      .status(201)
      .json(await comments.create(authOf(req), issueKeyOf(req), req.body as CreateCommentInput, query(req).project));
  };

  return { list, create };
}
