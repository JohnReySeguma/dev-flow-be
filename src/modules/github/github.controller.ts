import type { RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { verifySignature } from "../../integrations/github/webhook.js";
import type { GitHubService } from "./github.service.js";

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
