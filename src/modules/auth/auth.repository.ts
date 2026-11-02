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

    findRefreshToken: (tokenHash: string) =>
      prisma.refreshToken.findUnique({ where: { tokenHash }, include: { session: true } }),

    /**
     * Marks a refresh token as used. Atomic: of two concurrent claims only one succeeds,
     * so a token can never be exchanged twice. Returns false if it was already used.
     */
    claimRefreshToken: async (id: string, at: Date): Promise<boolean> =>
      (await prisma.refreshToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: at } })).count === 1,

    addRefreshToken: (sessionId: string, tokenHash: string) =>
      prisma.refreshToken.create({ data: { sessionId, tokenHash } }),

    revokeAllSessions: (userId: string, at: Date) =>
      prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } }),

    /** Issues a reset token and invalidates any earlier unused one, so only the newest link works. */
    createPasswordResetToken: (data: { userId: string; tokenHash: string; expiresAt: Date }) =>
      prisma.$transaction([
        prisma.passwordResetToken.updateMany({
          where: { userId: data.userId, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.passwordResetToken.create({ data }),
      ]),

    findPasswordResetToken: (tokenHash: string) => prisma.passwordResetToken.findUnique({ where: { tokenHash } }),

    /** Atomic, like refresh tokens: a reset link can be used once. */
    claimPasswordResetToken: async (id: string, at: Date): Promise<boolean> =>
      (await prisma.passwordResetToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: at } })).count === 1,
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
