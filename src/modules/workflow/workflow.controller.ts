import type { Request, RequestHandler, Response } from "express";
import { authOf } from "../../middleware/require-auth.js";
import type { VersionedProject } from "../projects/projects.service.js";
import type { AddStatusInput, ReorderStatusesInput, UpdateStatusInput } from "./workflow.schemas.js";
import type { WorkflowService } from "./workflow.service.js";

const keyOf = (req: Request) => String(req.params.key);
const statusIdOf = (req: Request) => String(req.params.id);
const send = (res: Response, { project, etag }: VersionedProject, status = 200) => {
  res.status(status).set("ETag", etag).json(project);
};

/** Every workflow change answers with the project and its updated workflow. */
export function createWorkflowController(workflow: WorkflowService) {
  const add: RequestHandler = async (req, res) => {
    send(res, await workflow.add(authOf(req), keyOf(req), req.body as AddStatusInput), 201);
  };

  const update: RequestHandler = async (req, res) => {
    send(res, await workflow.update(authOf(req), keyOf(req), statusIdOf(req), req.body as UpdateStatusInput));
  };

  const reorder: RequestHandler = async (req, res) => {
    send(res, await workflow.reorder(authOf(req), keyOf(req), req.body as ReorderStatusesInput));
  };

  const remove: RequestHandler = async (req, res) => {
    const { moveTo } = req.query as { moveTo?: string };
    send(res, await workflow.remove(authOf(req), keyOf(req), statusIdOf(req), moveTo));
  };

  return { add, update, reorder, remove };
}
