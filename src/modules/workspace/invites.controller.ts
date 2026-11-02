import type { Request, RequestHandler } from "express";
import { authOf } from "../../middleware/require-auth.js";
import { setSessionCookies } from "../auth/auth.cookies.js";
import type { InvitesService } from "./invites.service.js";
import type { AcceptInviteInput, InviteInput } from "./workspace.schemas.js";

const tokenOf = (req: Request) => String(req.params.token);

export function createInvitesController(invites: InvitesService) {
  const create: RequestHandler = async (req, res) => {
    res.status(201).json(await invites.invite(authOf(req), req.body as InviteInput));
  };

  const resend: RequestHandler = async (req, res) => {
    res.json(await invites.resend(authOf(req), String(req.params.id)));
  };

  const preview: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await invites.preview(tokenOf(req)));
  };

  const accept: RequestHandler = async (req, res) => {
    const { session, me } = await invites.accept(tokenOf(req), req.body as AcceptInviteInput, {
      userAgent: req.get("user-agent"),
    });
    setSessionCookies(res, session);
    res.status(201).json(me);
  };

  return { create, resend, preview, accept };
}
