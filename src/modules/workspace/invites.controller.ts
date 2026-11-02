import type { RequestHandler } from "express";
import { authOf } from "../../middleware/require-auth.js";
import type { InvitesService } from "./invites.service.js";
import type { InviteInput } from "./workspace.schemas.js";

export function createInvitesController(invites: InvitesService) {
  const create: RequestHandler = async (req, res) => {
    res.status(201).json(await invites.invite(authOf(req), req.body as InviteInput));
  };

  const resend: RequestHandler = async (req, res) => {
    res.json(await invites.resend(authOf(req), String(req.params.id)));
  };

  return { create, resend };
}
