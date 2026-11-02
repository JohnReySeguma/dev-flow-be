import type { Request, RequestHandler } from "express";
import type { PaginationQuery } from "../../lib/pagination.js";
import { authOf, identityOf } from "../../middleware/require-auth.js";
import type { ChangeRoleInput, CreateWorkspaceInput, RenameWorkspaceInput } from "./workspace.schemas.js";
import type { WorkspaceService } from "./workspace.service.js";

// validate({ query: paginationQuery }) has already replaced req.query with the parsed value.
const validatedQuery = (req: Request) => req.query as unknown as PaginationQuery;

export function createWorkspaceController(workspace: WorkspaceService) {
  const list: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await workspace.list(identityOf(req).userId, validatedQuery(req)));
  };

  const create: RequestHandler = async (req, res) => {
    res.status(201).json(await workspace.create(identityOf(req).userId, req.body as CreateWorkspaceInput));
  };

  const get: RequestHandler = (req, res) => {
    res.set("Cache-Control", "no-store").json(workspace.get(authOf(req)));
  };

  const rename: RequestHandler = async (req, res) => {
    res.json(await workspace.rename(authOf(req), (req.body as RenameWorkspaceInput).name));
  };

  const deleteWorkspace: RequestHandler = async (req, res) => {
    await workspace.delete(authOf(req));
    res.status(204).end();
  };

  const leave: RequestHandler = async (req, res) => {
    await workspace.leave(authOf(req));
    res.status(204).end();
  };

  const listMembers: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await workspace.listMembers(authOf(req), validatedQuery(req)));
  };

  const changeRole: RequestHandler = async (req, res) => {
    const { role } = req.body as ChangeRoleInput;
    res.json(await workspace.changeRole(authOf(req), String(req.params.id), role));
  };

  const remove: RequestHandler = async (req, res) => {
    await workspace.remove(authOf(req), String(req.params.id));
    res.status(204).end();
  };

  const resetDemo: RequestHandler = async (req, res) => {
    await workspace.resetDemoData(authOf(req));
    res.status(204).end();
  };

  return { list, create, get, rename, deleteWorkspace, leave, listMembers, changeRole, remove, resetDemo };
}
