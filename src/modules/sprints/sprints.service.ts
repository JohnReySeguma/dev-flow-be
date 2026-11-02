import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import type { Page } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { ProjectsService } from "../projects/projects.service.js";
import { toSprintView } from "./sprints.mapper.js";
import type { SprintsRepository, SprintWithProject } from "./sprints.repository.js";
import type { ListSprintsQuery, SprintView, UpdateSprintInput } from "./sprints.schemas.js";

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
