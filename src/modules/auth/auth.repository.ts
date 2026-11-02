import type { PrismaClient } from "../../lib/prisma.js";

export function createAuthRepository(prisma: PrismaClient) {
  return {
    /** Starts a session together with its first refresh token. */
    createSession: (data: { userId: string; expiresAt: Date; userAgent: string | null; refreshTokenHash: string }) =>
      prisma.session.create({
        data: {
          userId: data.userId,
          expiresAt: data.expiresAt,
          userAgent: data.userAgent,
          refreshTokens: { create: { tokenHash: data.refreshTokenHash } },
        },
      }),

    findSessionWithUser: (id: string) => prisma.session.findUnique({ where: { id }, include: { user: true } }),

    findSessionIdByRefreshHash: async (tokenHash: string) =>
      (await prisma.refreshToken.findUnique({ where: { tokenHash }, select: { sessionId: true } }))?.sessionId ?? null,

    revokeSession: (id: string, at: Date) =>
      prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } }),
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
