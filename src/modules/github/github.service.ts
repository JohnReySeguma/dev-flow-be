import { AppError } from "../../lib/errors.js";
import { branchOf, extractIssueRefs } from "../../integrations/github/webhook.js";
import type { IssuesService } from "../issues/issues.service.js";
import type { WorkspaceRepository } from "../workspace/workspace.repository.js";
import { pullRequestEvent, pushEvent, type WebhookResult } from "./github.schemas.js";

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

const shortSha = (sha: string) => sha.slice(0, 7);

/**
 * Turns verified GitHub deliveries into issue changes. DevFlow is single-workspace, so every
 * delivery applies to the default workspace.
 */
export function createGitHubService(deps: { issues: IssuesService; workspaces: WorkspaceRepository }) {
  const { issues, workspaces } = deps;

  async function pullRequest(payload: unknown): Promise<WebhookResult> {
    const parsed = pullRequestEvent.safeParse(payload);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Not a pull_request payload.");
    const { action, pull_request: pr } = parsed.data;
    if (!PR_ACTIONS.has(action)) return { event: "pull_request", handled: false, issues: [] };

    const workspace = await workspaces.findDefault();
    const refs = extractIssueRefs(pr.title, pr.head.ref);
    const changed = workspace
      ? await issues.applyGitActivity(workspace.id, refs, {
          kind: "pr",
          number: pr.number,
          state: pr.merged ? "merged" : pr.draft ? "draft" : "open",
          closedUnmerged: action === "closed" && !pr.merged,
        })
      : [];
    return { event: "pull_request", handled: true, issues: changed };
  }

  async function push(payload: unknown): Promise<WebhookResult> {
    const parsed = pushEvent.safeParse(payload);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Not a push payload.");
    const { ref, deleted, commits, head_commit: head } = parsed.data;
    if (deleted) return { event: "push", handled: false, issues: [] };

    const workspace = await workspaces.findDefault();
    if (!workspace) return { event: "push", handled: true, issues: [] };
    const changed = new Set<string>();
    const apply = async (text: string | undefined, sha: string) => {
      const keys = await issues.applyGitActivity(workspace.id, extractIssueRefs(text), {
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
        default:
          return { event, handled: false, issues: [] };
      }
    },
  };
}

export type GitHubService = ReturnType<typeof createGitHubService>;
