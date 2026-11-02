import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { problemResponse } from "../../openapi/problem.js";
import { webhookResult } from "./github.schemas.js";

export function registerGitHubDocs(registry: OpenAPIRegistry) {
  const json = { "application/json": { schema: webhookResult } };
  registry.registerPath({
    method: "post",
    path: "/integrations/github/webhook",
    tags: ["GitHub"],
    summary: "GitHub App webhook",
    description:
      "Called by GitHub, not by the frontend. Authenticated by `X-Hub-Signature-256` (HMAC-SHA256 of the raw body " +
      "with GITHUB_WEBHOOK_SECRET); returns 404 when the integration is not configured. Issue keys (DEV-104) " +
      "are read from PR titles, branch names and commit messages. A pull request links itself to those " +
      "issues (`git.kind = pr`), a merged one moves them to the project's first done status, and one closed " +
      "without merging removes its link. A commit links issues that have no pull request link. Changes are " +
      "broadcast over Live Sync with `actorId: null`. Handles `ping`, `pull_request` and `push`; other events " +
      "are acknowledged with 202.",
    request: {
      headers: z.object({
        "x-github-event": z.string().meta({ example: "pull_request" }),
        "x-hub-signature-256": z.string().meta({ example: "sha256=<hex>" }),
      }),
      body: { content: { "application/json": { schema: z.looseObject({}) } } },
    },
    responses: {
      200: { description: "Delivery handled.", content: json },
      202: { description: "Event or action ignored.", content: json },
      default: problemResponse,
    },
  });
}
