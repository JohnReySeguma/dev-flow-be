import type { RequestHandler } from "express";
import type { WorkspaceService } from "../modules/workspace/workspace.service.js";
import { authOf, identityOf } from "./require-auth.js";

/**
 * Resolves `:ws` (the workspace slug) to the caller's membership and attaches it to `req.auth`.
 * Non-members get 404, the same as for a workspace that does not exist, so slugs reveal nothing.
 */
export function requireMembership(deps: { workspace: WorkspaceService }): RequestHandler {
  return async (req, _res, next) => {
    req.auth = await deps.workspace.enter(identityOf(req), String(req.params.ws));
    next();
  };
}

/** For routers mounted under /workspaces/:ws, where `requireMembership` has already run. */
export const requireMember: RequestHandler = (req, _res, next) => {
  authOf(req);
  next();
};
