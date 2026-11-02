import type { Prisma, Sprint, SprintStatus } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** A sprint with the project it belongs to: routes address sprints by id, so the workspace check needs it. */
export type SprintWithProject = Prisma.SprintGetPayload<{
  include: { project: { select: { workspaceId: true; key: true } } };
}>;

function repository(db: Db) {
  return {
    /** Serialises sprint numbering and lifecycle changes per project. */
    lockProject: async (projectId: string): Promise<void> => {
      await db.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    },

    /** By number; fetches `limit + 1` so the caller can tell whether more exist. */
    list: (
      projectId: string,
      statuses: SprintStatus[] | undefined,
      limit: number,
      afterNumber?: number,
    ): Promise<Sprint[]> =>
      db.sprint.findMany({
        where: {
          projectId,
          ...(statuses && { status: { in: statuses } }),
          ...(afterNumber !== undefined && { number: { gt: afterNumber } }),
        },
        orderBy: { number: "asc" },
        take: limit + 1,
      }),

    findWithProject: (id: string): Promise<SprintWithProject | null> =>
      db.sprint.findUnique({ where: { id }, include: { project: { select: { workspaceId: true, key: true } } } }),

    findInProject: (projectId: string, id: string): Promise<Sprint | null> =>
      db.sprint.findFirst({ where: { id, projectId } }),

    findActive: (projectId: string): Promise<Sprint | null> =>
      db.sprint.findFirst({ where: { projectId, status: "active" } }),

    highestNumber: async (projectId: string): Promise<number> =>
      (await db.sprint.aggregate({ where: { projectId }, _max: { number: true } }))._max.number ?? 0,

    create: (data: { projectId: string; number: number; name: string }): Promise<Sprint> =>
      db.sprint.create({ data: { ...data, status: "planned" } }),

    update: (id: string, data: Prisma.SprintUpdateInput): Promise<Sprint> => db.sprint.update({ where: { id }, data }),

    delete: (id: string) => db.sprint.delete({ where: { id } }),

    /** The sprint's issues with what reports and carry-over need. */
    issuesIn: (sprintId: string) =>
      db.issue.findMany({
        where: { sprintId },
        select: {
          id: true,
          projectId: true,
          statusId: true,
          estimate: true,
          status: { select: { category: true } },
        },
      }),

    moveIssues: (issueIds: string[], sprintId: string | null) =>
      db.issue.updateMany({ where: { id: { in: issueIds } }, data: { sprintId } }),

    /** Full issues (with project key and status category) for event payloads. */
    issuesWithContext: (ids: string[]) =>
      db.issue.findMany({
        where: { id: { in: ids } },
        orderBy: [{ rank: "asc" }, { id: "asc" }],
        include: { project: { select: { key: true } }, status: { select: { category: true } } },
      }),

    recordEvents: (
      events: {
        issueId: string;
        projectId: string;
        actorId: string;
        sprintId: string | null;
        statusId: string;
        estimate: number | null;
        done: boolean;
      }[],
    ) => db.issueEvent.createMany({ data: events.map((event) => ({ ...event, kind: "sprint" as const })) }),
  };
}

export function createSprintsRepository(prisma: PrismaClient) {
  return {
    ...repository(prisma),
    /** Runs `fn` in one transaction with the same repository API bound to it. */
    transaction: <T>(fn: (tx: ReturnType<typeof repository>) => Promise<T>): Promise<T> =>
      prisma.$transaction((tx) => fn(repository(tx))),
  };
}

export type SprintsRepository = ReturnType<typeof createSprintsRepository>;
