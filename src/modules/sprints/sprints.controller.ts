import type { Request, RequestHandler } from "express";
import { authOf } from "../../middleware/require-auth.js";
import type { ListSprintsQuery, UpdateSprintInput } from "./sprints.schemas.js";
import type { SprintsService } from "./sprints.service.js";

// validate({ query }) has already replaced req.query with the parsed value.
const listQuery = (req: Request) => req.query as unknown as ListSprintsQuery;
const projectKeyOf = (req: Request) => String(req.params.key);
const sprintIdOf = (req: Request) => String(req.params.id);

export function createSprintsController(sprints: SprintsService) {
  const list: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await sprints.list(authOf(req), projectKeyOf(req), listQuery(req)));
  };

  const create: RequestHandler = async (req, res) => {
    res.status(201).json(await sprints.create(authOf(req), projectKeyOf(req)));
  };

  const update: RequestHandler = async (req, res) => {
    res.json(await sprints.update(authOf(req), sprintIdOf(req), req.body as UpdateSprintInput));
  };

  const remove: RequestHandler = async (req, res) => {
    await sprints.remove(authOf(req), sprintIdOf(req));
    res.status(204).end();
  };

  return { list, create, update, remove };
}
