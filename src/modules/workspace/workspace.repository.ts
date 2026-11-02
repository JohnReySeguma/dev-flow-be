import type { Prisma, Role, User, Workspace, WorkspaceInvite } from "../../generated/prisma/client.js";
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

    findMember: (workspaceId: string, id: string): Promise<User | null> =>
      db.user.findFirst({ where: { id, workspaceId } }),

    findInvite: (workspaceId: string, id: string): Promise<WorkspaceInvite | null> =>
      db.workspaceInvite.findFirst({ where: { id, workspaceId } }),

    /**
     * Locks the workspace's admin rows until the transaction ends and returns their ids, so
     * concurrent demotions or removals cannot leave the workspace without an admin.
     */
    lockAdminIds: async (workspaceId: string): Promise<string[]> =>
      (
        await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "users"
          WHERE "workspace_id" = ${workspaceId}::uuid AND "role" = 'admin'
          FOR UPDATE`
      ).map((row) => row.id),

    setMemberRole: (id: string, role: Role): Promise<User> => db.user.update({ where: { id }, data: { role } }),
    /** Deleting the user also ends their sessions and access tokens (cascade). */
    deleteMember: (id: string) => db.user.delete({ where: { id } }),

    setInviteRole: (id: string, role: Role): Promise<WorkspaceInvite> =>
      db.workspaceInvite.update({ where: { id }, data: { role } }),
    deleteInvite: (id: string) => db.workspaceInvite.delete({ where: { id } }),
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
