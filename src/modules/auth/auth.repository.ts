import type { OAuthProvider, User } from "../../generated/prisma/client.js";
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

    findSession: (id: string) => prisma.session.findUnique({ where: { id } }),

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

    /**
     * Signs the user out everywhere: revokes every session and deletes every access token, for when
     * someone else may have had access (a password reset, an account claimed through OAuth).
     */
    revokeAllCredentials: (userId: string, at: Date) =>
      prisma.$transaction([
        prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } }),
        prisma.accessToken.deleteMany({ where: { userId } }),
      ]),

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

    findUserByOAuthAccount: async (provider: OAuthProvider, providerAccountId: string): Promise<User | null> =>
      (
        await prisma.oAuthAccount.findUnique({
          where: { provider_providerAccountId: { provider, providerAccountId } },
          include: { user: true },
        })
      )?.user ?? null,

    linkOAuthAccount: (userId: string, provider: OAuthProvider, providerAccountId: string) =>
      prisma.oAuthAccount.create({ data: { userId, provider, providerAccountId } }),

    /** Atomic, like refresh tokens: a reset link can be used once. */
    claimPasswordResetToken: async (id: string, at: Date): Promise<boolean> =>
      (await prisma.passwordResetToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: at } })).count === 1,
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
