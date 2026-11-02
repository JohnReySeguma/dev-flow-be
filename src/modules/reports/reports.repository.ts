import type { Sprint } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";
import type { IssueState } from "./burndown.js";

export function createReportsRepository(prisma: PrismaClient) {
  return {
    /** The full history of every issue that was ever in the sprint, oldest first. */
    sprintHistory: async (sprintId: string): Promise<IssueState[]> => {
      const issues = await prisma.issueEvent.findMany({
        where: { sprintId },
        distinct: ["issueId"],
        select: { issueId: true },
      });
      const events = await prisma.issueEvent.findMany({
        where: { issueId: { in: issues.map((i) => i.issueId) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { issueId: true, sprintId: true, estimate: true, done: true, createdAt: true },
      });
      return events.map(({ createdAt, ...state }) => ({ ...state, at: createdAt }));
    },

    /** Completed sprints, newest first; fetches `limit + 1` when paging. */
    completedSprints: (projectId: string, limit: number, beforeNumber?: number): Promise<Sprint[]> =>
      prisma.sprint.findMany({
        where: {
          projectId,
          status: "completed",
          ...(beforeNumber !== undefined && { number: { lt: beforeNumber } }),
        },
        orderBy: { number: "desc" },
        take: limit,
      }),
  };
}

export type ReportsRepository = ReturnType<typeof createReportsRepository>;
