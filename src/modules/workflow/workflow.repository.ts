import type { Prisma, StatusCategory, WorkflowStatus } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

type Db = PrismaClient | Prisma.TransactionClient;

function repository(db: Db) {
  return {
    /** Serialises workflow edits per project, so guards are checked against the latest workflow. */
    lockProject: async (projectId: string): Promise<void> => {
      await db.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    },

    /** The workflow in board order. */
    listStatuses: (projectId: string): Promise<WorkflowStatus[]> =>
      db.workflowStatus.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }] }),

    createStatus: (data: { projectId: string; name: string; category: StatusCategory; position: number }) =>
      db.workflowStatus.create({ data }),

    updateStatus: (id: string, data: { name?: string; category?: StatusCategory }) =>
      db.workflowStatus.update({ where: { id }, data }),

    /** Rewrites positions 0..n-1 in the given order. */
    setOrder: async (statusIds: string[]): Promise<void> => {
      for (const [position, id] of statusIds.entries()) {
        await db.workflowStatus.update({ where: { id }, data: { position } });
      }
    },

    deleteStatus: (id: string) => db.workflowStatus.delete({ where: { id } }),

    issuesInStatus: (statusId: string) =>
      db.issue.findMany({
        where: { statusId },
        select: { id: true, projectId: true, sprintId: true, estimate: true, resolvedAt: true },
      }),

    moveIssue: (id: string, statusId: string, resolvedAt: Date | null) =>
      db.issue.update({ where: { id }, data: { statusId, resolvedAt } }),

    /** After a category change: issues entering done keep any resolvedAt they had; issues leaving done lose it. */
    resolveIssuesInStatus: async (statusId: string, done: boolean, now: Date): Promise<void> => {
      if (done) await db.issue.updateMany({ where: { statusId, resolvedAt: null }, data: { resolvedAt: now } });
      else await db.issue.updateMany({ where: { statusId }, data: { resolvedAt: null } });
    },

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
    ) => db.issueEvent.createMany({ data: events.map((event) => ({ ...event, kind: "status" as const })) }),

    /** The workflow is part of the project's representation, so its ETag must change too. */
    touchProject: (projectId: string) =>
      db.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } }),
  };
}

export function createWorkflowRepository(prisma: PrismaClient) {
  return {
    ...repository(prisma),
    transaction: <T>(fn: (tx: ReturnType<typeof repository>) => Promise<T>): Promise<T> =>
      prisma.$transaction((tx) => fn(repository(tx))),
  };
}

export type WorkflowRepository = ReturnType<typeof createWorkflowRepository>;
