import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import type { IssueEventKind, StatusCategory } from "../../generated/prisma/client.js";
import { AppError, type FieldError } from "../../lib/errors.js";
import { ifMatchSatisfied, versionTag } from "../../lib/etag.js";
import type { Page } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { ProjectsService } from "../projects/projects.service.js";
import { toIssueView } from "./issues.mapper.js";
import type { IssueFilters, IssuesRepository, IssueWithContext, IssueWrite, RankCursor } from "./issues.repository.js";
import type { CreateIssueInput, IssueView, ListIssuesQuery, UpdateIssueInput } from "./issues.schemas.js";

export type VersionedIssue = { issue: IssueView; etag: string };

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

export function createIssuesService(deps: { issues: IssuesRepository; projects: ProjectsService }) {
  const { issues, projects } = deps;

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

  async function record(tx: Tx, issue: IssueWithContext, kind: IssueEventKind, actorId: string) {
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
      return issues.transaction(async (tx) => {
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

      return issues.transaction(async (tx) => {
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
    },

    async remove(auth: AuthContext, issueKey: string, projectKey?: string): Promise<void> {
      await issues.delete((await find(auth, issueKey, projectKey)).id);
    },
  };
}

export type IssuesService = ReturnType<typeof createIssuesService>;
