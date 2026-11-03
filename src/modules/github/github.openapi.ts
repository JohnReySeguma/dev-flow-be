import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { problemResponse } from "../../openapi/problem.js";
import { githubStatusResponse, webhookResult } from "./github.schemas.js";

/** `workspace` registers under /workspaces/{workspace}; the webhook and setup callback are version-free. */
export function registerGitHubDocs(registry: OpenAPIRegistry, workspace: OpenAPIRegistry) {
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
      "broadcast over Live Sync with `actorId: null`. Deliveries change issues only in the workspace their " +
      "installation is linked to; deliveries from unlinked installations are acknowledged with 202. Handles " +
      "`ping`, `pull_request`, `push` and `installation` (uninstalling unlinks); other events are acknowledged " +
      "with 202.",
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
  registry.registerPath({
    method: "get",
    path: "/integrations/github/setup",
    tags: ["GitHub"],
    summary: "GitHub's redirect after installing the App (called by the browser)",
    description:
      "Registered as the GitHub App's callback URL, with user authorization during installation. Checks the " +
      "state against the devflow_github cookie, asks GitHub which installations the installing user can " +
      "access, and links the installation to the workspace the install started from. Always redirects to " +
      "{CORS_ORIGIN}{redirect}?github=linked, or ?github_error=<code>: github_denied, github_state_mismatch, " +
      "github_not_your_installation, github_installation_taken, github_forbidden, github_failed.",
    request: {
      query: z.object({ code: z.string(), installation_id: z.string(), setup_action: z.string(), state: z.string() }),
    },
    responses: { 302: { description: "Back to the frontend." } },
  });
  workspace.registerPath({
    method: "get",
    path: "/integrations/github",
    tags: ["GitHub"],
    summary: "GitHub installations linked to the workspace",
    description: "Any role; access tokens need issues:read.",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    responses: {
      200: {
        description: "Whether linking is available, and the linked installations.",
        content: { "application/json": { schema: githubStatusResponse } },
      },
      default: problemResponse,
    },
  });
  workspace.registerPath({
    method: "get",
    path: "/integrations/github/install",
    tags: ["GitHub"],
    summary: "Install the GitHub App for this workspace (browser navigation)",
    description:
      "Admins only, signed-in session only; navigate the browser here, not fetch. Sets a short-lived state cookie " +
      "and redirects to GitHub's install page; GitHub comes back through /api/integrations/github/setup, which " +
      "redirects to {CORS_ORIGIN}{redirect}. redirect is a relative frontend path (default /projects). 404 when " +
      "the integration is not configured; 403 DEMO_WORKSPACE_LOCKED in the demo workspace.",
    security: [{ cookieAuth: [] }],
    request: { query: z.object({ redirect: z.string().optional() }) },
    responses: { 302: { description: "To GitHub." }, default: problemResponse },
  });
  workspace.registerPath({
    method: "delete",
    path: "/integrations/github/installations/{id}",
    tags: ["GitHub"],
    summary: "Unlink an installation",
    description:
      "Admins only, signed-in session only. Its deliveries stop changing this workspace; the App stays installed on " +
      "GitHub (uninstall it there to remove it). 404 when it is not linked here; 403 DEMO_WORKSPACE_LOCKED.",
    security: [{ cookieAuth: [] }],
    request: { params: z.object({ id: z.coerce.number().int() }) },
    responses: { 204: { description: "Unlinked." }, default: problemResponse },
  });
}
