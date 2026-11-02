import { decodeNumberCursor, encodeNumberCursor, type Page } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { ProjectsService } from "../projects/projects.service.js";
import { toSprintView } from "../sprints/sprints.mapper.js";
import type { SprintView } from "../sprints/sprints.schemas.js";
import type { SprintsService } from "../sprints/sprints.service.js";
import { burndown } from "./burndown.js";
import type { ReportsRepository } from "./reports.repository.js";
import type { Burndown, HistoryQuery, Velocity } from "./reports.schemas.js";

export function createReportsService(deps: {
  reports: ReportsRepository;
  sprints: SprintsService;
  projects: ProjectsService;
}) {
  const { reports, sprints, projects } = deps;

  return {
    /** One point per sprint day from the issue history; no days for a sprint that has not started. */
    async burndown(auth: AuthContext, sprintId: string, now = new Date()): Promise<Burndown> {
      const sprint = await sprints.find(auth, sprintId);
      const days =
        sprint.startAt && sprint.endAt
          ? burndown(
              {
                id: sprint.id,
                startAt: sprint.startAt,
                endAt: sprint.endAt,
                completedAt: sprint.completedAt,
                committedPoints: sprint.committedPoints,
              },
              await reports.sprintHistory(sprint.id),
              now,
            )
          : [];
      return { sprintId: sprint.id, committedPoints: sprint.committedPoints, days };
    },

    /** Committed against completed points for the most recent completed sprints, oldest first. */
    async velocity(auth: AuthContext, key: string, limit: number): Promise<Velocity> {
      const project = await projects.find(auth, key);
      const recent = await reports.completedSprints(project.id, limit);
      return recent.reverse().map((sprint) => ({
        sprintId: sprint.id,
        name: sprint.name,
        committed: sprint.reportCommittedPoints ?? sprint.committedPoints ?? 0,
        completed: sprint.reportCompletedPoints ?? 0,
      }));
    },

    /** Completed sprints with goal, dates and report, newest first. */
    async history(auth: AuthContext, key: string, query: HistoryQuery): Promise<Page<SprintView>> {
      const project = await projects.find(auth, key);
      const before = query.cursor === undefined ? undefined : decodeNumberCursor(query.cursor);
      const rows = await reports.completedSprints(project.id, query.limit + 1, before);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toSprintView),
        nextCursor: rows.length > query.limit && last ? encodeNumberCursor(last.number) : null,
      };
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
