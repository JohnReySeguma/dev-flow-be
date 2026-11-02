import type { Request, RequestHandler } from "express";
import type { PaginationQuery } from "../../lib/pagination.js";
import { authOf } from "../../middleware/require-auth.js";
import type { WorkspaceService } from "./workspace.service.js";

// validate({ query: paginationQuery }) has already replaced req.query with the parsed value.
const validatedQuery = (req: Request) => req.query as unknown as PaginationQuery;

export function createWorkspaceController(workspace: WorkspaceService) {
  const get: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await workspace.get(authOf(req)));
  };

  const listMembers: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await workspace.listMembers(authOf(req), validatedQuery(req)));
  };

  return { get, listMembers };
}
