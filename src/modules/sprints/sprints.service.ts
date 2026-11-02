import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import type { Page } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { ProjectsService } from "../projects/projects.service.js";
import { toSprintView } from "./sprints.mapper.js";
import type { SprintsRepository, SprintWithProject } from "./sprints.repository.js";
import type {
  CompleteSprintInput,
  ListSprintsQuery,
  SprintView,
  StartSprintInput,
  UpdateSprintInput,
} from "./sprints.schemas.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const points = (issues: { estimate: number | null }[]) => issues.reduce((sum, i) => sum + (i.estimate ?? 0), 0);

/** Sprints page by number, so the cursor is the last number seen (opaque to clients). */
const encodeCursor = (number: number) => Buffer.from(JSON.stringify({ n: number })).toString("base64url");
const cursorShape = z.object({ n: z.number().int().min(0) });

function decodeCursor(cursor: string): number {
  try {
    return cursorShape.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).n;
  } catch (error) {
    throw new AppError("VALIDATION_FAILED", "The request contains invalid fields.", {
      errors: [{ field: "cursor", message: "Invalid cursor; use the nextCursor from the previous page." }],
      cause: error,
    });
  }
}

export function createSprintsService(deps: { sprints: SprintsRepository; projects: ProjectsService }) {
  const { sprints, projects } = deps;

  /** Resolves a sprint id within the caller's workspace, or 404. */
  async function find(auth: AuthContext, id: string): Promise<SprintWithProject> {
    const sprint = z.uuid().safeParse(id).success ? await sprints.findWithProject(id) : null;
    if (sprint?.project.workspaceId !== auth.workspaceId) throw new AppError("NOT_FOUND", "No sprint with that id.");
    return sprint;
  }

  return {
    find,

    async list(auth: AuthContext, key: string, query: ListSprintsQuery): Promise<Page<SprintView>> {
      const project = await projects.find(auth, key);
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const rows = await sprints.list(project.id, query.status, query.limit, after);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toSprintView),
        nextCursor: rows.length > query.limit && last ? encodeCursor(last.number) : null,
      };
    },

    /** Creates `Sprint {n+1}` in the planned state, as the backlog's "+ Sprint" does. */
    async create(auth: AuthContext, key: string): Promise<SprintView> {
      const project = await projects.find(auth, key);
      return sprints.transaction(async (tx) => {
        await tx.lockProject(project.id);
        const number = (await tx.highestNumber(project.id)) + 1;
        return toSprintView(await tx.create({ projectId: project.id, number, name: `Sprint ${number}` }));
      });
    },

    async update(auth: AuthContext, id: string, input: UpdateSprintInput): Promise<SprintView> {
      const sprint = await find(auth, id);
      return toSprintView(
        await sprints.update(sprint.id, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.goal !== undefined && { goal: input.goal }),
        }),
      );
    },

    /**
     * Starts a planned sprint for `durationDays` from now and snapshots the points it holds. Only
     * one sprint per project can be active.
     */
    async start(auth: AuthContext, id: string, input: StartSprintInput): Promise<SprintView> {
      const found = await find(auth, id);
      return sprints.transaction(async (tx) => {
        await tx.lockProject(found.projectId);
        const sprint = await tx.findInProject(found.projectId, found.id);
        if (sprint?.status !== "planned")
          throw new AppError("SPRINT_NOT_PLANNED", "Only planned sprints can be started.");
        const active = await tx.findActive(found.projectId);
        if (active) {
          throw new AppError("SPRINT_ALREADY_ACTIVE", `${active.name} is already active. Complete it first.`);
        }
        const now = Date.now();
        return toSprintView(
          await tx.update(sprint.id, {
            name: input.name,
            goal: input.goal,
            status: "active",
            startAt: new Date(now),
            endAt: new Date(now + input.durationDays * DAY_MS),
            committedPoints: points(await tx.issuesIn(sprint.id)),
          }),
        );
      });
    },

    /**
     * Completes the active sprint in one transaction: writes the report, marks it completed and
     * moves unfinished issues to the backlog, a planned sprint or a new sprint.
     */
    async complete(
      auth: AuthContext,
      id: string,
      { carryOver }: CompleteSprintInput,
    ): Promise<{ sprint: SprintView; carriedOverTo: SprintView | null }> {
      const found = await find(auth, id);
      return sprints.transaction(async (tx) => {
        await tx.lockProject(found.projectId);
        const sprint = await tx.findInProject(found.projectId, found.id);
        if (sprint?.status !== "active")
          throw new AppError("SPRINT_NOT_ACTIVE", "Only the active sprint can be completed.");

        let target = null;
        if (carryOver.kind === "sprint") {
          target = await tx.findInProject(found.projectId, carryOver.sprintId);
          if (target?.status !== "planned") {
            throw new AppError("VALIDATION_FAILED", "The request contains invalid fields.", {
              errors: [{ field: "carryOver.sprintId", message: "Pick a planned sprint of this project." }],
            });
          }
        } else if (carryOver.kind === "new-sprint") {
          const number = (await tx.highestNumber(found.projectId)) + 1;
          target = await tx.create({ projectId: found.projectId, number, name: `Sprint ${number}` });
        }

        const issues = await tx.issuesIn(sprint.id);
        const done = issues.filter((i) => i.status.category === "done");
        const open = issues.filter((i) => i.status.category !== "done");
        const completed = await tx.update(sprint.id, {
          status: "completed",
          completedAt: new Date(),
          reportCommittedPoints: sprint.committedPoints ?? points(issues),
          reportCompletedPoints: points(done),
          reportCompletedIssues: done.length,
          reportCarriedOverIssues: open.length,
        });

        const targetId = target?.id ?? null;
        await tx.moveIssues(
          open.map((i) => i.id),
          targetId,
        );
        await tx.recordEvents(
          open.map((issue) => ({
            issueId: issue.id,
            projectId: issue.projectId,
            actorId: auth.userId,
            sprintId: targetId,
            statusId: issue.statusId,
            estimate: issue.estimate,
            done: false,
          })),
        );
        return { sprint: toSprintView(completed), carriedOverTo: target ? toSprintView(target) : null };
      });
    },

    /** Planned sprints only; their issues return to the backlog. */
    async remove(auth: AuthContext, id: string): Promise<void> {
      const found = await find(auth, id);
      await sprints.transaction(async (tx) => {
        await tx.lockProject(found.projectId);
        const sprint = await tx.findInProject(found.projectId, found.id);
        if (sprint?.status !== "planned") {
          throw new AppError("SPRINT_NOT_PLANNED", "Only planned sprints can be deleted.");
        }
        const issues = await tx.issuesIn(sprint.id);
        await tx.moveIssues(
          issues.map((i) => i.id),
          null,
        );
        await tx.recordEvents(
          issues.map((issue) => ({
            issueId: issue.id,
            projectId: issue.projectId,
            actorId: auth.userId,
            sprintId: null,
            statusId: issue.statusId,
            estimate: issue.estimate,
            done: issue.status.category === "done",
          })),
        );
        await tx.delete(sprint.id);
      });
    },
  };
}

export type SprintsService = ReturnType<typeof createSprintsService>;
