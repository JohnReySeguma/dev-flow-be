import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import type { IssueEventKind, StatusCategory } from "../../generated/prisma/client.js";
import { AppError, type FieldError } from "../../lib/errors.js";
import { ifMatchSatisfied, versionTag } from "../../lib/etag.js";
import type { Page } from "../../lib/pagination.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { IssueRef } from "../../integrations/github/webhook.js";
import type { EventBus, EventProject } from "../../realtime/events.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { ProjectsService } from "../projects/projects.service.js";
import { issueKeyOf, toIssueView } from "./issues.mapper.js";
import { gitLink } from "./issues.schemas.js";
import type { IssueFilters, IssuesRepository, IssueWithContext, IssueWrite, RankCursor } from "./issues.repository.js";
import type {
  CreateIssueInput,
  IssueView,
  ListIssuesQuery,
  MoveIssueInput,
  UpdateIssueInput,
} from "./issues.schemas.js";

export type VersionedIssue = { issue: IssueView; etag: string };

/** What happened on GitHub, reduced to what DevFlow records. */
export type GitActivity =
  | { kind: "pr"; number: number; state: "open" | "draft" | "merged"; closedUnmerged: boolean }
  | { kind: "commit"; sha: string };

type Tx = Parameters<Parameters<IssuesRepository["transaction"]>[0]>[0];

const versioned = (issue: IssueWithContext): VersionedIssue => ({
  issue: toIssueView(issue),
  etag: versionTag(issue.id, issue.updatedAt),
});

const invalid = (field: string, message: string) =>
  new AppError("VALIDATION_FAILED", "The request contains invalid fields.", { errors: [{ field, message }] });

const stale = () => new AppError("CONFLICT_STALE", "The issue changed since it was loaded. Reload and try again.");

/** `resolvedAt` follows done-ness: set on entering a done status, kept while staying done, cleared on leaving. */
export function nextResolvedAt(
  current: Date | null,
  from: StatusCategory | null,
  to: StatusCategory,
  now: Date,
): Date | null {
  if (to !== "done") return null;
  return from === "done" ? (current ?? now) : now;
}

const ISSUE_KEY = /^([A-Za-z]{2,5})-(\d+)$/;
const BARE_NUMBER = /^\d+$/;

const encodeRankCursor = (cursor: RankCursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
const rankCursorShape = z.object({ rank: z.string().min(1).max(200), id: z.uuid() });
function decodeRankCursor(cursor: string): RankCursor {
  try {
    return rankCursorShape.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch (error) {
    throw new AppError("VALIDATION_FAILED", "The request contains invalid fields.", {
      errors: [{ field: "cursor", message: "Invalid cursor; use the nextCursor from the previous page." }],
      cause: error,
    });
  }
}

export function createIssuesService(deps: { issues: IssuesRepository; projects: ProjectsService; events: EventBus }) {
  const { issues, projects, events } = deps;

  /** Live Sync: tells the project's room, after the change committed. */
  const announce = (
    event: "issue.created" | "issue.updated",
    result: VersionedIssue,
    project: EventProject,
    actorId: string | null,
  ) => {
    events.publish(project, event, { actorId, issue: result.issue });
  };

  /**
   * issue.moved also says where the issue now ranks, the way a move request does: the issue it
   * sits before, or null when it is last. Clients don't see ranks, so they need this to re-order.
   */
  async function announceMoved(moved: IssueWithContext, actorId: string | null) {
    const after = await issues.issueAfter(moved.projectId, moved);
    events.publish(moved.project, "issue.moved", {
      actorId,
      issue: versioned(moved).issue,
      beforeIssueKey: after ? `${moved.project.key}-${after.number}` : null,
    });
  }

  /** Checks that referenced statuses, sprints and assignees belong to this project and workspace. */
  async function checkReferences(
    tx: Tx,
    auth: AuthContext,
    projectId: string,
    refs: { statusId?: string; sprintId?: string | null; assigneeId?: string | null },
  ) {
    const errors: FieldError[] = [];
    const status = refs.statusId === undefined ? null : await tx.findStatus(projectId, refs.statusId);
    if (refs.statusId !== undefined && !status) {
      errors.push({ field: "statusId", message: "Pick a status from this project's workflow." });
    }
    if (refs.sprintId) {
      const sprint = await tx.findSprint(projectId, refs.sprintId);
      if (sprint?.status !== "planned" && sprint?.status !== "active") {
        errors.push({ field: "sprintId", message: "Pick a planned or active sprint of this project, or null." });
      }
    }
    if (refs.assigneeId && !(await tx.isWorkspaceMember(auth.workspaceId, refs.assigneeId))) {
      errors.push({ field: "assigneeId", message: "Pick a member of this workspace, or null." });
    }
    if (errors.length > 0) {
      throw new AppError("VALIDATION_FAILED", "The request contains invalid fields.", { errors });
    }
    return status;
  }

  async function record(tx: Tx, issue: IssueWithContext, kind: IssueEventKind, actorId: string | null) {
    await tx.recordEvent({
      issueId: issue.id,
      projectId: issue.projectId,
      kind,
      actorId,
      sprintId: issue.sprintId,
      statusId: issue.statusId,
      estimate: issue.estimate,
      done: issue.status.category === "done",
    });
  }

  /**
   * Resolves an issue key: `DEV-104` / `dev-104`, or a bare `104` together with `?project=DEV`
   * (the ⌘K jump knows the current project).
   */
  async function find(auth: AuthContext, issueKey: string, projectKey?: string): Promise<IssueWithContext> {
    let key: string;
    let number: number;
    const match = ISSUE_KEY.exec(issueKey);
    if (match?.[1] && match[2]) {
      key = match[1];
      number = Number(match[2]);
    } else if (BARE_NUMBER.test(issueKey)) {
      if (!projectKey) throw invalid("project", "Add ?project=<KEY> when using a bare issue number.");
      key = projectKey;
      number = Number(issueKey);
    } else {
      throw new AppError("NOT_FOUND", `No issue with key ${issueKey}.`);
    }
    const project = await projects.find(auth, key);
    const issue = Number.isSafeInteger(number) ? await issues.findByNumber(project.id, number) : null;
    if (!issue) throw new AppError("NOT_FOUND", `No issue ${project.key}-${number}.`);
    return issue;
  }

  return {
    find,

    async list(auth: AuthContext, projectKey: string, query: ListIssuesQuery): Promise<Page<IssueView>> {
      const project = await projects.find(auth, projectKey);
      const filters: IssueFilters = {};
      if (query.sprint === "backlog") filters.sprintId = null;
      else if (query.sprint === "active") {
        const active = await issues.findActiveSprint(project.id);
        if (!active) return { items: [], nextCursor: null };
        filters.sprintId = active.id;
      } else if (query.sprint) filters.sprintId = query.sprint;
      if (query.mine) filters.assigneeId = auth.userId;
      else if (query.assignee) filters.assigneeId = query.assignee === "none" ? null : query.assignee;
      if (query.priority) filters.priority = query.priority;
      if (query.type) filters.type = query.type;
      if (query.q) {
        const keyMatch = ISSUE_KEY.exec(query.q);
        const number =
          keyMatch?.[1]?.toUpperCase() === project.key
            ? Number(keyMatch[2])
            : BARE_NUMBER.test(query.q)
              ? Number(query.q)
              : null;
        filters.search = { text: query.q, number };
      }

      const cursor = query.cursor === undefined ? undefined : decodeRankCursor(query.cursor);
      const rows = await issues.list(project.id, filters, query.limit, cursor);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toIssueView),
        nextCursor: rows.length > query.limit && last ? encodeRankCursor({ rank: last.rank, id: last.id }) : null,
      };
    },

    async get(auth: AuthContext, issueKey: string, projectKey?: string): Promise<VersionedIssue> {
      return versioned(await find(auth, issueKey, projectKey));
    },

    /** New issues take the next number and go to the top of the project's ranking. */
    async create(auth: AuthContext, projectKey: string, input: CreateIssueInput): Promise<VersionedIssue> {
      const project = await projects.find(auth, projectKey);
      const result = await issues.transaction(async (tx) => {
        const chosen = await checkReferences(tx, auth, project.id, {
          ...(input.statusId !== undefined && { statusId: input.statusId }),
          sprintId: input.sprintId,
          assigneeId: input.assigneeId,
        });
        const status = chosen ?? (await tx.defaultStatus(project.id));
        if (!status) throw new AppError("INTERNAL_ERROR", "The project has no workflow statuses.");

        const number = await tx.reserveNumber(project.id);
        const issue = await tx.create({
          projectId: project.id,
          number,
          sprintId: input.sprintId,
          statusId: status.id,
          type: input.type,
          priority: input.priority,
          title: input.title,
          description: input.description,
          assigneeId: input.assigneeId,
          estimate: input.estimate,
          rank: generateKeyBetween(null, await tx.firstRank(project.id)),
          resolvedAt: status.category === "done" ? new Date() : null,
        });
        await record(tx, issue, "created", auth.userId);
        return versioned(issue);
      });
      announce("issue.created", result, project, auth.userId);
      return result;
    },

    /** With `ifMatch`, rejects the change (412) if the issue changed since the client read it. */
    async update(
      auth: AuthContext,
      issueKey: string,
      input: UpdateIssueInput,
      options: { projectKey?: string; ifMatch?: string } = {},
    ): Promise<VersionedIssue> {
      const current = await find(auth, issueKey, options.projectKey);
      if (
        options.ifMatch !== undefined &&
        !ifMatchSatisfied(options.ifMatch, versionTag(current.id, current.updatedAt))
      ) {
        throw stale();
      }

      const result = await issues.transaction(async (tx) => {
        const status = await checkReferences(tx, auth, current.projectId, {
          ...(input.statusId !== undefined && { statusId: input.statusId }),
          ...(input.sprintId !== undefined && { sprintId: input.sprintId }),
          ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
        });
        const data: IssueWrite = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
        if (status && status.id !== current.statusId) {
          data.resolvedAt = nextResolvedAt(current.resolvedAt, current.status.category, status.category, new Date());
        }
        const updated = await tx.update(
          current.id,
          data,
          options.ifMatch === undefined ? undefined : current.updatedAt,
        );
        if (!updated) throw stale();

        if (updated.statusId !== current.statusId) await record(tx, updated, "status", auth.userId);
        if (updated.sprintId !== current.sprintId) await record(tx, updated, "sprint", auth.userId);
        if (updated.estimate !== current.estimate) await record(tx, updated, "estimate", auth.userId);
        return versioned(updated);
      });
      announce("issue.updated", result, current.project, auth.userId);
      return result;
    },

    /**
     * Board drop and backlog ranking: changes the status and/or sprint and re-ranks the issue.
     * Placement: before `beforeIssueKey` when given; otherwise a status-only change floats the
     * issue to the top and a sprint change sends it to the end.
     */
    async move(
      auth: AuthContext,
      issueKey: string,
      input: MoveIssueInput,
      projectKey?: string,
    ): Promise<VersionedIssue> {
      const current = await find(auth, issueKey, projectKey);
      const before =
        input.beforeIssueKey === undefined ? null : await find(auth, input.beforeIssueKey, current.project.key);
      if (before && (before.projectId !== current.projectId || before.id === current.id)) {
        throw invalid("beforeIssueKey", "Pick another issue of the same project.");
      }

      const moved = await issues.transaction(async (tx) => {
        await tx.lockProject(current.projectId);
        const status = await checkReferences(tx, auth, current.projectId, {
          ...(input.statusId !== undefined && { statusId: input.statusId }),
          ...(input.sprintId !== undefined && { sprintId: input.sprintId }),
        });

        let rank: string;
        if (before) {
          // Re-read the target under the lock: its rank may have changed since it was looked up.
          const target = await tx.findByNumber(before.projectId, before.number);
          if (!target) throw new AppError("NOT_FOUND", `No issue ${input.beforeIssueKey ?? ""}.`);
          rank = generateKeyBetween(await tx.rankBefore(current.projectId, target, current.id), target.rank);
        } else if (input.sprintId !== undefined) {
          rank = generateKeyBetween(await tx.lastRank(current.projectId, current.id), null);
        } else {
          rank = generateKeyBetween(null, await tx.firstRank(current.projectId, current.id));
        }

        const data: IssueWrite = { rank };
        if (input.sprintId !== undefined) data.sprintId = input.sprintId;
        if (status && status.id !== current.statusId) {
          data.statusId = status.id;
          data.resolvedAt = nextResolvedAt(current.resolvedAt, current.status.category, status.category, new Date());
        }
        const updated = await tx.update(current.id, data);
        if (!updated) throw new AppError("NOT_FOUND", `No issue ${issueKey}.`);
        if (updated.statusId !== current.statusId) await record(tx, updated, "status", auth.userId);
        if (updated.sprintId !== current.sprintId) await record(tx, updated, "sprint", auth.userId);
        return updated;
      });
      await announceMoved(moved, auth.userId);
      return versioned(moved);
    },

    async remove(auth: AuthContext, issueKey: string, projectKey?: string): Promise<void> {
      const issue = await find(auth, issueKey, projectKey);
      await issues.delete(issue.id);
      events.publish(issue.project, "issue.deleted", {
        actorId: auth.userId,
        issueKey: issueKeyOf(issue),
      });
    },

    /**
     * Applies GitHub activity to the issues it mentions, as the system (actorId null). A pull
     * request links (or, closed unmerged, unlinks) itself and, once merged, moves the issue to the
     * project's first done status; a commit links only issues without a pull request link.
     * Unknown keys are ignored. Returns the keys of the issues that changed.
     */
    async applyGitActivity(workspaceId: string, refs: IssueRef[], activity: GitActivity): Promise<string[]> {
      const changed: string[] = [];
      for (const ref of refs) {
        const project = await projects.findInWorkspace(workspaceId, ref.projectKey);
        const current = project ? await issues.findByNumber(project.id, ref.number) : null;
        if (!current) continue;
        const linked = gitLink.safeParse(current.git);
        const currentLink = linked.success ? linked.data : null;

        const data: IssueWrite = {};
        if (activity.kind === "pr") {
          if (activity.closedUnmerged) {
            if (currentLink?.kind === "pr" && currentLink.number === activity.number) data.git = Prisma.DbNull;
          } else {
            data.git = { kind: "pr", number: activity.number, state: activity.state };
          }
        } else if (currentLink?.kind !== "pr") {
          data.git = { kind: "commit", sha: activity.sha };
        }

        const result = await issues.transaction(async (tx) => {
          if (activity.kind === "pr" && activity.state === "merged" && current.status.category !== "done") {
            const done = await tx.firstDoneStatus(current.projectId);
            if (done) {
              data.statusId = done.id;
              data.resolvedAt = nextResolvedAt(current.resolvedAt, current.status.category, done.category, new Date());
            }
          }
          if (Object.keys(data).length === 0) return null;
          const updated = await tx.update(current.id, data);
          if (updated && updated.statusId !== current.statusId) await record(tx, updated, "status", null);
          return updated;
        });
        if (!result) continue;
        if (result.statusId === current.statusId) announce("issue.updated", versioned(result), result.project, null);
        else await announceMoved(result, null);
        changed.push(issueKeyOf(result));
      }
      return changed;
    },

    /** Re-reads an issue another module changed (e.g. its comment count) and announces it. */
    async announceUpdated(issue: IssueWithContext, actorId: string | null): Promise<void> {
      const fresh = await issues.findByNumber(issue.projectId, issue.number);
      if (fresh) announce("issue.updated", versioned(fresh), fresh.project, actorId);
    },
  };
}

export type IssuesService = ReturnType<typeof createIssuesService>;
