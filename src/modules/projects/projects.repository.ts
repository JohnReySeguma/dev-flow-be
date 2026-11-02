import type { Prisma, StatusCategory } from "../../generated/prisma/client.js";
import { afterCursorAsc, type Cursor } from "../../lib/pagination.js";
import type { PrismaClient } from "../../lib/prisma.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** A project with its workflow in board order: the shape every caller needs. */
const withWorkflow = { statuses: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] } };

export type ProjectWithWorkflow = Prisma.ProjectGetPayload<{ include: typeof withWorkflow }>;

function repository(db: Db) {
  return {
    /** Oldest first; fetches `limit + 1` so the caller can tell whether more exist. */
    list: (workspaceId: string, limit: number, cursor?: Cursor): Promise<ProjectWithWorkflow[]> =>
      db.project.findMany({
        where: { workspaceId, ...(cursor && afterCursorAsc(cursor)) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        include: withWorkflow,
      }),

    findByKey: (workspaceId: string, key: string): Promise<ProjectWithWorkflow | null> =>
      db.project.findUnique({ where: { workspaceId_key: { workspaceId, key } }, include: withWorkflow }),

    countInWorkspace: (workspaceId: string) => db.project.count({ where: { workspaceId } }),

    create: (data: {
      workspaceId: string;
      key: string;
      name: string;
      description: string;
      color: string;
      leadId: string;
      statuses: { name: string; category: StatusCategory }[];
    }): Promise<ProjectWithWorkflow> =>
      db.project.create({
        data: {
          workspaceId: data.workspaceId,
          key: data.key,
          name: data.name,
          description: data.description,
          color: data.color,
          leadId: data.leadId,
          statuses: { create: data.statuses.map((status, position) => ({ ...status, position })) },
        },
        include: withWorkflow,
      }),

    /**
     * Updates name/description. With `expectedUpdatedAt` the write only happens if the row is
     * unchanged since it was read. Returns null when that check fails.
     */
    update: async (
      id: string,
      data: { name?: string; description?: string },
      expectedUpdatedAt?: Date,
    ): Promise<ProjectWithWorkflow | null> => {
      const { count } = await db.project.updateMany({
        where: { id, ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }) },
        data,
      });
      return count === 1 ? db.project.findUnique({ where: { id }, include: withWorkflow }) : null;
    },

    /** Cascades to the workflow, sprints, issues and comments. */
    delete: (id: string) => db.project.delete({ where: { id } }),
  };
}

export function createProjectsRepository(prisma: PrismaClient) {
  return {
    ...repository(prisma),
    /** Runs `fn` in one transaction with the same repository API bound to it. */
    transaction: <T>(fn: (tx: ReturnType<typeof repository>) => Promise<T>): Promise<T> =>
      prisma.$transaction((tx) => fn(repository(tx))),
  };
}

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>;
