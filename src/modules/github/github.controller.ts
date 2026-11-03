import type { CookieOptions, RequestHandler } from "express";
import { verifySignature } from "../../integrations/github/webhook.js";
import { AppError } from "../../lib/errors.js";
import { authOf } from "../../middleware/require-auth.js";
import { GITHUB_STATE_TTL_SECONDS, type GitHubService } from "./github.service.js";

export function createGitHubController(deps: { github: GitHubService; secret: string | null }) {
  const { github, secret } = deps;

  const webhook: RequestHandler = async (req, res) => {
    if (!secret) throw new AppError("NOT_FOUND", "The GitHub integration is not configured.");
    // express.raw leaves an empty object, not a Buffer, when there is no body.
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifySignature(secret, raw, req.get("x-hub-signature-256"))) {
      throw new AppError("WEBHOOK_SIGNATURE_INVALID");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      throw new AppError("BAD_REQUEST", "The webhook body is not valid JSON.", { cause: error });
    }
    const result = await github.handle(req.get("x-github-event") ?? "", payload);
    res.status(result.handled ? 200 : 202).json(result);
  };

  return { webhook };
}

const STATE_COOKIE = "devflow_github";
// The version-free path of the setup callback (app.ts PROVIDER_PREFIX), where the state is read back.
const STATE_PATH = "/api/integrations/github";
const stateCookie: CookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: STATE_PATH };

/** Linking installations: the workspace's settings page, the install redirect and GitHub's callback. */
export function createGitHubLinkController(github: GitHubService) {
  const status: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await github.status(authOf(req)));
  };

  /** A browser navigation: sets the state cookie and sends the admin to GitHub. */
  const install: RequestHandler = (req, res) => {
    const { url, stateToken } = github.startInstall(authOf(req), req.query.redirect);
    res.cookie(STATE_COOKIE, stateToken, { ...stateCookie, maxAge: GITHUB_STATE_TTL_SECONDS * 1000 });
    res.redirect(302, url);
  };

  /** Always ends in a browser redirect to the frontend, never in a JSON error. */
  const setup: RequestHandler = async (req, res) => {
    const cookie = (req.cookies as Record<string, unknown>)[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, stateCookie);
    res.redirect(302, await github.finishInstall(req.query, typeof cookie === "string" ? cookie : undefined));
  };

  const unlink: RequestHandler = async (req, res) => {
    await github.unlink(authOf(req), Number(req.params.id));
    res.status(204).end();
  };

  return { status, install, setup, unlink };
}
