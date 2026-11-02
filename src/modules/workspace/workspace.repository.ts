import { Prisma, type Role, type User, type Workspace, type WorkspaceInvite } from "../../generated/prisma/client.js";
import { afterCursorAsc, type Cursor } from "../../lib/pagination.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { slugBase, slugWithSuffix } from "../../lib/slug.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** A membership with its user: one row of the members list. */
export type Member = { workspaceId: string; userId: string; role: Role; createdAt: Date; user: User };

const SLUG_ATTEMPTS = 5;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const inviteListArgs = (workspaceId: string, limit: number, cursor?: Cursor) => ({
  where: { workspaceId, ...(cursor && afterCursorAsc(cursor)) },
  orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  take: limit + 1,
});

function repository(db: Db) {
  return {
    findById: (id: string): Promise<Workspace | null> => db.workspace.findUnique({ where: { id } }),
    /** The seeded demo workspace, which GitHub deliveries apply to until installations are linked per workspace. */
    findDemo: (): Promise<Workspace | null> =>
      db.workspace.findFirst({ where: { isDemo: true }, orderBy: { createdAt: "asc" } }),

    /**
     * Creates a workspace with a slug from its name, suffixed when that slug is taken, and makes
     * `ownerId` its admin.
     */
    create: async (name: string, options: { ownerId?: string; isDemo?: boolean } = {}): Promise<Workspace> => {
      const base = slugBase(name);
      for (let attempt = 0; ; attempt++) {
        const slug = attempt === 0 ? base : slugWithSuffix(base);
        try {
          return await db.workspace.create({
            data: {
              name,
              slug,
              isDemo: options.isDemo ?? false,
              ...(options.ownerId && { members: { create: { userId: options.ownerId, role: "admin" } } }),
            },
          });
        } catch (error) {
          if (!isUniqueViolation(error) || attempt + 1 >= SLUG_ATTEMPTS) throw error;
        }
      }
    },

    /** Members by join date, oldest first; fetches `limit + 1` so the caller can tell whether more exist. */
    listMembers: (workspaceId: string, limit: number, cursor?: Cursor): Promise<Member[]> =>
      db.workspaceMember.findMany({
        where: {
          workspaceId,
          ...(cursor && {
            OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, userId: { gt: cursor.id } }],
          }),
        },
        orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
        take: limit + 1,
        include: { user: true },
      }),

    listInvites: (workspaceId: string, limit: number, cursor?: Cursor): Promise<WorkspaceInvite[]> =>
      db.workspaceInvite.findMany(inviteListArgs(workspaceId, limit, cursor)),

    findMember: (workspaceId: string, userId: string): Promise<Member | null> =>
      db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        include: { user: true },
      }),

    countMembers: (workspaceId: string) => db.workspaceMember.count({ where: { workspaceId } }),

    /** The caller's membership in the workspace with this slug, or null when they are not a member. */
    findMembershipBySlug: (userId: string, slug: string) =>
      db.workspaceMember.findFirst({ where: { userId, workspace: { slug } }, include: { workspace: true } }),

    /** Every workspace the user belongs to, oldest membership first. */
    listMemberships: (userId: string) =>
      db.workspaceMember.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { workspaceId: "asc" }],
        include: { workspace: true },
      }),

    findInvite: (workspaceId: string, id: string): Promise<WorkspaceInvite | null> =>
      db.workspaceInvite.findFirst({ where: { id, workspaceId } }),

    /**
     * Locks the workspace's admin memberships until the transaction ends and returns their user
     * ids, so concurrent demotions or removals cannot leave the workspace without an admin.
     */
    lockAdminIds: async (workspaceId: string): Promise<string[]> =>
      (
        await db.$queryRaw<{ user_id: string }[]>`
          SELECT "user_id" FROM "workspace_members"
          WHERE "workspace_id" = ${workspaceId}::uuid AND "role" = 'admin'
          FOR UPDATE`
      ).map((row) => row.user_id),

    setMemberRole: (workspaceId: string, userId: string, role: Role): Promise<Member> =>
      db.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { role },
        include: { user: true },
      }),
    /** Deleting the user also ends their sessions and access tokens (cascade). */
    deleteMember: (userId: string) => db.user.delete({ where: { id: userId } }),

    findInviteByEmail: (workspaceId: string, email: string): Promise<WorkspaceInvite | null> =>
      db.workspaceInvite.findUnique({ where: { workspaceId_email: { workspaceId, email } } }),

    createInvite: (data: {
      workspaceId: string;
      email: string;
      role: Role;
      tokenHash: string;
      invitedById: string;
      expiresAt: Date;
    }): Promise<WorkspaceInvite> => db.workspaceInvite.create({ data }),

    /** A new token and expiry: every earlier link for this invite stops working. */
    rotateInviteToken: (id: string, tokenHash: string, expiresAt: Date): Promise<WorkspaceInvite> =>
      db.workspaceInvite.update({ where: { id }, data: { tokenHash, expiresAt } }),

    findInviteByTokenHash: (tokenHash: string) =>
      db.workspaceInvite.findUnique({
        where: { tokenHash },
        include: { workspace: true, invitedBy: { select: { name: true } } },
      }),

    /** Deletes the invite if this token is still its current one. Atomic: an invite is accepted once. */
    claimInvite: async (id: string, tokenHash: string): Promise<boolean> =>
      (await db.workspaceInvite.deleteMany({ where: { id, tokenHash } })).count === 1,

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
