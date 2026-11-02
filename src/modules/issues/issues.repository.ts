import type {
  IssueEventKind,
  IssueType,
  Prisma,
  Priority,
  Sprint,
  WorkflowStatus,
} from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** What the API returns for an issue needs the project key (for `id`) and the status category. */
const withContext = { project: { select: { key: true } }, status: { select: { category: true } } } as const;

export type IssueWithContext = Prisma.IssueGetPayload<{ include: typeof withContext }>;

/** Position after an issue in (rank asc, id asc) order. */
export type RankCursor = { rank: string; id: string };

export type IssueFilters = {
  sprintId?: string | null;
  assigneeId?: string | null;
  priority?: Priority;
  type?: IssueType;
  /** Matches the title or description (case-insensitive), or this issue number. */
  search?: { text: string; number: number | null };
};

export type IssueWrite = {
  sprintId?: string | null;
  statusId?: string;
  type?: IssueType;
  priority?: Priority;
  title?: string;
  description?: string;
  assigneeId?: string | null;
  estimate?: number | null;
  rank?: string;
  resolvedAt?: Date | null;
};

function repository(db: Db) {
  return {
    /**
     * Reserves the next issue number. The UPDATE locks the project row until the transaction
     * ends, so concurrent creates in one project never share a number (or compute ranks at once).
     */
    reserveNumber: async (projectId: string): Promise<number> => {
      const [row] = await db.$queryRaw<{ number: number }[]>`
        UPDATE "projects" SET "next_issue_number" = "next_issue_number" + 1, "updated_at" = now()
        WHERE "id" = ${projectId}::uuid
        RETURNING "next_issue_number" - 1 AS "number"`;
      if (!row) throw new Error(`project ${projectId} vanished while creating an issue`);
      return row.number;
    },

    /** Serialises rank changes per project, so two moves never compute the same rank. */
    lockProject: async (projectId: string): Promise<void> => {
      await db.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    },

    /** The rank just before `issue` in project order, ignoring `excludeId` (the issue being moved). */
    rankBefore: async (projectId: string, issue: RankCursor, excludeId: string): Promise<string | null> =>
      (
        await db.issue.findFirst({
          where: {
            projectId,
            id: { not: excludeId },
            OR: [{ rank: { lt: issue.rank } }, { rank: issue.rank, id: { lt: issue.id } }],
          },
          orderBy: [{ rank: "desc" }, { id: "desc" }],
          select: { rank: true },
        })
      )?.rank ?? null,

    /** The rank at the bottom of the project, ignoring `excludeId`. */
    lastRank: async (projectId: string, excludeId: string): Promise<string | null> =>
      (
        await db.issue.findFirst({
          where: { projectId, id: { not: excludeId } },
          orderBy: [{ rank: "desc" }, { id: "desc" }],
          select: { rank: true },
        })
      )?.rank ?? null,

    /** The rank of the issue currently at the top of the project, if any. */
    firstRank: async (projectId: string, excludeId?: string): Promise<string | null> =>
      (
        await db.issue.findFirst({
          where: { projectId, ...(excludeId && { id: { not: excludeId } }) },
          orderBy: [{ rank: "asc" }, { id: "asc" }],
          select: { rank: true },
        })
      )?.rank ?? null,

    create: (data: {
      projectId: string;
      number: number;
      sprintId: string | null;
      statusId: string;
      type: IssueType;
      priority: Priority;
      title: string;
      description: string;
      assigneeId: string | null;
      estimate: number | null;
      rank: string;
      resolvedAt: Date | null;
    }): Promise<IssueWithContext> => db.issue.create({ data, include: withContext }),

    findByNumber: (projectId: string, number: number): Promise<IssueWithContext | null> =>
      db.issue.findUnique({ where: { projectId_number: { projectId, number } }, include: withContext }),

    /** In rank order; fetches `limit + 1` so the caller can tell whether more exist. */
    list: (projectId: string, filters: IssueFilters, limit: number, cursor?: RankCursor) =>
      db.issue.findMany({
        where: {
          projectId,
          ...(filters.sprintId !== undefined && { sprintId: filters.sprintId }),
          ...(filters.assigneeId !== undefined && { assigneeId: filters.assigneeId }),
          ...(filters.priority && { priority: filters.priority }),
          ...(filters.type && { type: filters.type }),
          ...(filters.search && {
            OR: [
              { title: { contains: filters.search.text, mode: "insensitive" as const } },
              { description: { contains: filters.search.text, mode: "insensitive" as const } },
              ...(filters.search.number === null ? [] : [{ number: filters.search.number }]),
            ],
          }),
          ...(cursor && {
            AND: [{ OR: [{ rank: { gt: cursor.rank } }, { rank: cursor.rank, id: { gt: cursor.id } }] }],
          }),
        },
        orderBy: [{ rank: "asc" }, { id: "asc" }],
        take: limit + 1,
        include: withContext,
      }),

    /**
     * Applies a change. With `expectedUpdatedAt` the write only happens if the issue is unchanged
     * since it was read. Returns null when that check fails.
     */
    update: async (id: string, data: IssueWrite, expectedUpdatedAt?: Date): Promise<IssueWithContext | null> => {
      const { count } = await db.issue.updateMany({
        where: { id, ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }) },
        data,
      });
      return count === 1 ? db.issue.findUnique({ where: { id }, include: withContext }) : null;
    },

    delete: (id: string) => db.issue.delete({ where: { id } }),

    recordEvent: (data: {
      issueId: string;
      projectId: string;
      kind: IssueEventKind;
      actorId: string | null;
      sprintId: string | null;
      statusId: string;
      estimate: number | null;
      done: boolean;
    }) => db.issueEvent.create({ data }),

    findStatus: (projectId: string, id: string): Promise<WorkflowStatus | null> =>
      db.workflowStatus.findFirst({ where: { id, projectId } }),

    /** The default status for new issues: the first to-do status, else the first status. */
    defaultStatus: async (projectId: string): Promise<WorkflowStatus | null> =>
      (await db.workflowStatus.findFirst({
        where: { projectId, category: "todo" },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      })) ?? db.workflowStatus.findFirst({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }] }),

    findSprint: (projectId: string, id: string): Promise<Sprint | null> =>
      db.sprint.findFirst({ where: { id, projectId } }),

    findActiveSprint: (projectId: string): Promise<Sprint | null> =>
      db.sprint.findFirst({ where: { projectId, status: "active" } }),

    isWorkspaceMember: async (workspaceId: string, userId: string) =>
      (await db.user.count({ where: { id: userId, workspaceId } })) === 1,
  };
}

export function createIssuesRepository(prisma: PrismaClient) {
  return {
    ...repository(prisma),
    /** Runs `fn` in one transaction with the same repository API bound to it. */
    transaction: <T>(fn: (tx: ReturnType<typeof repository>) => Promise<T>): Promise<T> =>
      prisma.$transaction((tx) => fn(repository(tx))),
  };
}

export type IssuesRepository = ReturnType<typeof createIssuesRepository>;
