import type { Request, RequestHandler } from "express";
import type { PaginationQuery } from "../../lib/pagination.js";
import { authOf } from "../../middleware/require-auth.js";
import type { CreateProjectInput, UpdateProjectInput } from "./projects.schemas.js";
import type { ProjectsService } from "./projects.service.js";

// validate({ query: paginationQuery }) has already replaced req.query with the parsed value.
const validatedQuery = (req: Request) => req.query as unknown as PaginationQuery;
const keyOf = (req: Request) => String(req.params.key);

export function createProjectsController(projects: ProjectsService) {
  const list: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await projects.list(authOf(req), validatedQuery(req)));
  };

  const create: RequestHandler = async (req, res) => {
    const { project, etag } = await projects.create(authOf(req), req.body as CreateProjectInput);
    res.status(201).set("ETag", etag).json(project);
  };

  const get: RequestHandler = async (req, res) => {
    const { project, etag } = await projects.get(authOf(req), keyOf(req));
    res.set({ ETag: etag, "Cache-Control": "no-store" }).json(project);
  };

  const update: RequestHandler = async (req, res) => {
    const { project, etag } = await projects.update(
      authOf(req),
      keyOf(req),
      req.body as UpdateProjectInput,
      req.get("if-match"),
    );
    res.set("ETag", etag).json(project);
  };

  const remove: RequestHandler = async (req, res) => {
    await projects.remove(authOf(req), keyOf(req));
    res.status(204).end();
  };

  return { list, create, get, update, remove };
}
