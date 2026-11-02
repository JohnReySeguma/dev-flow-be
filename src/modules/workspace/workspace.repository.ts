import type { Prisma, User, Workspace, WorkspaceInvite } from "../../generated/prisma/client.js";
import { afterCursorAsc, type Cursor } from "../../lib/pagination.js";
import type { PrismaClient } from "../../lib/prisma.js";

type Db = PrismaClient | Prisma.TransactionClient;

const listArgs = (workspaceId: string, limit: number, cursor?: Cursor) => ({
  where: { workspaceId, ...(cursor && afterCursorAsc(cursor)) },
  orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  take: limit + 1,
});

function repository(db: Db) {
  return {
    findById: (id: string): Promise<Workspace | null> => db.workspace.findUnique({ where: { id } }),
    /** The single workspace (multiple workspaces are out of scope). */
    findDefault: (): Promise<Workspace | null> => db.workspace.findFirst({ orderBy: { createdAt: "asc" } }),
    create: (name: string): Promise<Workspace> => db.workspace.create({ data: { name } }),

    /** Members oldest first; fetches `limit + 1` so the caller can tell whether more exist. */
    listMembers: (workspaceId: string, limit: number, cursor?: Cursor): Promise<User[]> =>
      db.user.findMany(listArgs(workspaceId, limit, cursor)),

    listInvites: (workspaceId: string, limit: number, cursor?: Cursor): Promise<WorkspaceInvite[]> =>
      db.workspaceInvite.findMany(listArgs(workspaceId, limit, cursor)),
  };
}

export function createWorkspaceRepository(prisma: PrismaClient) {
  return {
    ...repository(prisma),
    /** Runs `fn` in one transaction with the same repository API bound to it. */
    transaction: <T>(fn: (tx: ReturnType<typeof repository>) => Promise<T>): Promise<T> =>
      prisma.$transaction((tx) => fn(repository(tx))),
  };
}

export type WorkspaceRepository = ReturnType<typeof createWorkspaceRepository>;
