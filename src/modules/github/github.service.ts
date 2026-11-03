import jwt from "jsonwebtoken";
import type { GitHubAppClient } from "../../integrations/github/app-client.js";
import { branchOf, extractIssueRefs } from "../../integrations/github/webhook.js";
import { randomToken, safeEqual } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { safeRedirect } from "../auth/oauth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { IssuesService } from "../issues/issues.service.js";
import type { WorkspaceRepository } from "../workspace/workspace.repository.js";
import type { GitHubRepository } from "./github.repository.js";
import {
  installationEvent,
  pullRequestEvent,
  pushEvent,
  type GitHubStatus,
  type WebhookResult,
} from "./github.schemas.js";

/** Pull request actions that can change the link or its state; labels, reviews etc. are ignored. */
const PR_ACTIONS = new Set([
  "opened",
  "reopened",
  "edited",
  "synchronize",
  "ready_for_review",
  "converted_to_draft",
  "closed",
]);

export const GITHUB_STATE_TTL_SECONDS = 10 * 60;
const STATE_AUDIENCE = "devflow:github-install";

/** Where the setup callback sends the browser on failure: `?github_error=<code>`. */
export const GITHUB_LINK_ERRORS = [
  "github_denied",
  "github_state_mismatch",
  "github_not_your_installation",
  "github_installation_taken",
  "github_forbidden",
  "github_failed",
] as const;
export type GitHubLinkErrorCode = (typeof GITHUB_LINK_ERRORS)[number];

export class GitHubLinkError extends Error {
  override name = "GitHubLinkError";
  constructor(readonly code: GitHubLinkErrorCode) {
    super(code);
  }
}

type StateClaims = { workspaceId: string; slug: string; userId: string; redirect: string; nonce: string };

const shortSha = (sha: string) => sha.slice(0, 7);
const withQuery = (path: string, query: string) => `${path}${path.includes("?") ? "&" : "?"}${query}`;

/**
 * Links GitHub App installations to workspaces and turns verified deliveries into issue changes
 * in the workspace their installation is linked to. Deliveries from unlinked installations change
 * nothing.
 */
export function createGitHubService(deps: {
  issues: IssuesService;
  installations: GitHubRepository;
  workspaces: WorkspaceRepository;
  /** Null when the GitHub integration is not configured. */
  app: GitHubAppClient | null;
  /** github.com/apps/<slug>. */
  appSlug: string | undefined;
  /** Signs the install state. */
  secret: string;
  /** The frontend origin the setup callback redirects back to. */
  frontendUrl: string;
  logger: Logger;
}) {
  const { issues, installations, workspaces, app, logger } = deps;

  const workspaceOf = async (payload: unknown): Promise<string | null> => {
    const id = (payload as { installation?: { id?: unknown } } | null)?.installation?.id;
    return typeof id === "number" ? ((await installations.find(id))?.workspaceId ?? null) : null;
  };

  async function pullRequest(payload: unknown): Promise<WebhookResult> {
    const parsed = pullRequestEvent.safeParse(payload);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Not a pull_request payload.");
    const { action, pull_request: pr } = parsed.data;
    const workspaceId = await workspaceOf(payload);
    if (!PR_ACTIONS.has(action) || !workspaceId) return { event: "pull_request", handled: false, issues: [] };

    const changed = await issues.applyGitActivity(workspaceId, extractIssueRefs(pr.title, pr.head.ref), {
      kind: "pr",
      number: pr.number,
      state: pr.merged ? "merged" : pr.draft ? "draft" : "open",
      closedUnmerged: action === "closed" && !pr.merged,
    });
    return { event: "pull_request", handled: true, issues: changed };
  }

  async function push(payload: unknown): Promise<WebhookResult> {
    const parsed = pushEvent.safeParse(payload);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Not a push payload.");
    const { ref, deleted, commits, head_commit: head } = parsed.data;
    const workspaceId = await workspaceOf(payload);
    if (deleted || !workspaceId) return { event: "push", handled: false, issues: [] };

    const changed = new Set<string>();
    const apply = async (text: string | undefined, sha: string) => {
      const keys = await issues.applyGitActivity(workspaceId, extractIssueRefs(text), {
        kind: "commit",
        sha: shortSha(sha),
      });
      keys.forEach((key) => changed.add(key));
    };
    // Oldest first, so an issue mentioned twice ends up linked to its latest commit.
    for (const commit of commits) await apply(commit.message, commit.id);
    if (head && ref.startsWith("refs/heads/")) await apply(branchOf(ref), head.id);
    return { event: "push", handled: true, issues: [...changed] };
  }

  /** Uninstalling the App on GitHub unlinks it here. */
  async function installation(payload: unknown): Promise<WebhookResult> {
    const parsed = installationEvent.safeParse(payload);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Not an installation payload.");
    if (parsed.data.action !== "deleted") return { event: "installation", handled: false, issues: [] };
    await installations.remove(parsed.data.installation.id);
    return { event: "installation", handled: true, issues: [] };
  }

  function readState(token: string | undefined, fromQuery: unknown): StateClaims {
    if (token && typeof fromQuery === "string" && safeEqual(token, fromQuery)) {
      try {
        return jwt.verify(token, deps.secret, { algorithms: ["HS256"], audience: STATE_AUDIENCE }) as StateClaims;
      } catch {
        // Expired or forged.
      }
    }
    throw new GitHubLinkError("github_state_mismatch");
  }

  return {
    /** Handles one delivery whose signature has already been verified. */
    async handle(event: string, payload: unknown): Promise<WebhookResult> {
      switch (event) {
        case "ping":
          return { event, handled: true, issues: [] };
        case "pull_request":
          return pullRequest(payload);
        case "push":
          return push(payload);
        case "installation":
          return installation(payload);
        default:
          return { event, handled: false, issues: [] };
      }
    },

    status: async (auth: AuthContext): Promise<GitHubStatus> => ({
      enabled: app !== null,
      installations: (await installations.listForWorkspace(auth.workspaceId)).map((i) => ({
        installationId: Number(i.installationId),
        account: i.accountLogin,
        linkedAt: i.createdAt.toISOString(),
      })),
    }),

    /**
     * The GitHub page that installs the App, and a signed state for the caller's cookie. GitHub
     * comes back to the setup callback with both, so the link lands in this workspace.
     */
    startInstall(auth: AuthContext, redirect: unknown): { url: string; stateToken: string } {
      if (!app || !deps.appSlug) throw new AppError("NOT_FOUND", "The GitHub integration is not configured.");
      const claims: StateClaims = {
        workspaceId: auth.workspaceId,
        slug: auth.workspace.slug,
        userId: auth.userId,
        redirect: safeRedirect(redirect),
        nonce: randomToken(16),
      };
      const stateToken = jwt.sign(claims, deps.secret, {
        algorithm: "HS256",
        audience: STATE_AUDIENCE,
        expiresIn: GITHUB_STATE_TTL_SECONDS,
      });
      const url = new URL(`https://github.com/apps/${deps.appSlug}/installations/new`);
      url.searchParams.set("state", stateToken);
      return { url: url.toString(), stateToken };
    },

    /**
     * Finishes linking after GitHub's redirect. GitHub's user authorization code proves which
     * installations the person can access; the signed state (matched against their cookie) says
     * which workspace and DevFlow admin started it. Always returns a frontend URL.
     */
    async finishInstall(
      query: { code?: unknown; installation_id?: unknown; state?: unknown },
      stateCookie: string | undefined,
    ): Promise<string> {
      let redirect = "/projects";
      try {
        const claims = readState(stateCookie, query.state);
        redirect = claims.redirect;
        const installationId = Number(query.installation_id);
        if (!app || typeof query.code !== "string" || !query.code || !Number.isSafeInteger(installationId)) {
          throw new GitHubLinkError("github_denied");
        }
        const member = await workspaces.findMember(claims.workspaceId, claims.userId);
        if (member?.role !== "admin" || member.workspaceId !== claims.workspaceId) {
          throw new GitHubLinkError("github_forbidden");
        }
        let accessible;
        try {
          accessible = await app.userInstallations(query.code);
        } catch (error) {
          logger.warn({ err: error }, "github installation check failed");
          throw new GitHubLinkError("github_failed");
        }
        const found = accessible.find((i) => i.id === installationId);
        if (!found) throw new GitHubLinkError("github_not_your_installation");
        const existing = await installations.find(installationId);
        if (existing && existing.workspaceId !== claims.workspaceId) {
          throw new GitHubLinkError("github_installation_taken");
        }
        await installations.link({
          installationId,
          workspaceId: claims.workspaceId,
          accountLogin: found.account.login,
          linkedById: claims.userId,
        });
        return `${deps.frontendUrl}${withQuery(redirect, "github=linked")}`;
      } catch (error) {
        const code = error instanceof GitHubLinkError ? error.code : "github_failed";
        if (!(error instanceof GitHubLinkError)) logger.error({ err: error }, "github installation link failed");
        return `${deps.frontendUrl}${withQuery(redirect, `github_error=${code}`)}`;
      }
    },

    /** Stops deliveries from that installation changing this workspace; the App stays installed on GitHub. */
    async unlink(auth: AuthContext, installationId: number): Promise<void> {
      if (!Number.isSafeInteger(installationId) || !(await installations.unlink(auth.workspaceId, installationId))) {
        throw new AppError("NOT_FOUND", "That installation is not linked to this workspace.");
      }
    },
  };
}

export type GitHubService = ReturnType<typeof createGitHubService>;
