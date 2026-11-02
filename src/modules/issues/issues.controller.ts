import type { Request, RequestHandler } from "express";
import { authOf } from "../../middleware/require-auth.js";
import type { CreateIssueInput, ListIssuesQuery, MoveIssueInput, UpdateIssueInput } from "./issues.schemas.js";
import type { IssuesService } from "./issues.service.js";

// validate({ query }) has already replaced req.query with the parsed value.
const listQuery = (req: Request) => req.query as unknown as ListIssuesQuery;
const lookupProject = (req: Request) => (req.query as { project?: string }).project;
const projectKeyOf = (req: Request) => String(req.params.key);
const issueKeyOf = (req: Request) => String(req.params.issueKey);

export function createIssuesController(issues: IssuesService) {
  const list: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await issues.list(authOf(req), projectKeyOf(req), listQuery(req)));
  };

  const create: RequestHandler = async (req, res) => {
    const { issue, etag } = await issues.create(authOf(req), projectKeyOf(req), req.body as CreateIssueInput);
    res.status(201).set("ETag", etag).json(issue);
  };

  const get: RequestHandler = async (req, res) => {
    const { issue, etag } = await issues.get(authOf(req), issueKeyOf(req), lookupProject(req));
    res.set({ ETag: etag, "Cache-Control": "no-store" }).json(issue);
  };

  const update: RequestHandler = async (req, res) => {
    const project = lookupProject(req);
    const ifMatch = req.get("if-match");
    const { issue, etag } = await issues.update(authOf(req), issueKeyOf(req), req.body as UpdateIssueInput, {
      ...(project !== undefined && { projectKey: project }),
      ...(ifMatch !== undefined && { ifMatch }),
    });
    res.set("ETag", etag).json(issue);
  };

  const move: RequestHandler = async (req, res) => {
    const { issue, etag } = await issues.move(
      authOf(req),
      issueKeyOf(req),
      req.body as MoveIssueInput,
      lookupProject(req),
    );
    res.set("ETag", etag).json(issue);
  };

  const remove: RequestHandler = async (req, res) => {
    await issues.remove(authOf(req), issueKeyOf(req), lookupProject(req));
    res.status(204).end();
  };

  return { list, create, get, update, move, remove };
}
