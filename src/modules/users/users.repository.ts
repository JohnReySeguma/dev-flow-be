import type { Role, User } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

export type NewUser = {
  email: string;
  name: string;
  handle: string;
  gradient: string;
  passwordHash: string | null;
  /** Set when the address is already proven, e.g. by an accepted invite. */
  emailVerifiedAt?: Date;
  /** The workspace the account joins (an invite), created in the same statement. */
  membership?: { workspaceId: string; role: Role };
};

export function createUsersRepository(prisma: PrismaClient) {
  return {
    findById: (id: string): Promise<User | null> => prisma.user.findUnique({ where: { id } }),
    findByEmail: (email: string): Promise<User | null> => prisma.user.findUnique({ where: { email } }),
    handleExists: async (handle: string) => (await prisma.user.count({ where: { handle } })) > 0,
    create: ({ membership, ...data }: NewUser): Promise<User> =>
      prisma.user.create({ data: { ...data, ...(membership && { memberships: { create: membership } }) } }),
    /**
     * Applies a profile change. With `expectedUpdatedAt` the write only happens if the row is
     * unchanged since it was read, in the same statement, so concurrent edits cannot be lost.
     * Returns null when that check fails.
     */
    updateProfile: async (
      id: string,
      data: { name?: string; gradient?: string; timezone?: string; bio?: string },
      expectedUpdatedAt?: Date,
    ): Promise<User | null> => {
      const { count } = await prisma.user.updateMany({
        where: { id, ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }) },
        data,
      });
      return count === 1 ? prisma.user.findUnique({ where: { id } }) : null;
    },
    /** null removes password sign-in (OAuth only). */
    setPasswordHash: (id: string, passwordHash: string | null) =>
      prisma.user.update({ where: { id }, data: { passwordHash } }),
    touchLastActive: (id: string, at: Date) => prisma.user.update({ where: { id }, data: { lastActiveAt: at } }),
    /** Records that the owner proved the address; keeps the first proof. */
    markEmailVerified: (id: string, at: Date) =>
      prisma.user.updateMany({ where: { id, emailVerifiedAt: null }, data: { emailVerifiedAt: at } }),
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
