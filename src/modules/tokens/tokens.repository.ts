import type { AccessToken, Workspace } from "../../generated/prisma/client.js";
import { afterCursor, type Cursor } from "../../lib/pagination.js";
import type { PrismaClient } from "../../lib/prisma.js";

export type TokenWithWorkspace = AccessToken & { workspace: Workspace };

/** lastUsedAt is refreshed at most once a minute, so busy scripts do not write on every request. */
const LAST_USED_RESOLUTION_MS = 60_000;

export function createTokensRepository(prisma: PrismaClient) {
  return {
    create: (data: {
      userId: string;
      workspaceId: string;
      name: string;
      tokenHash: string;
      lastFour: string;
      scopes: string[];
      expiresAt: Date | null;
    }): Promise<TokenWithWorkspace> => prisma.accessToken.create({ data, include: { workspace: true } }),

    /** Newest first; fetches `limit + 1` rows so the caller can tell whether another page exists. */
    listForUser: (userId: string, limit: number, cursor?: Cursor): Promise<TokenWithWorkspace[]> =>
      prisma.accessToken.findMany({
        where: { userId, ...(cursor && afterCursor(cursor)) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        include: { workspace: true },
      }),

    findByHash: (tokenHash: string) => prisma.accessToken.findUnique({ where: { tokenHash } }),

    /** The workspace with this slug, if the user is a member of it. */
    findMemberWorkspace: (userId: string, slug: string): Promise<Workspace | null> =>
      prisma.workspace.findFirst({ where: { slug, members: { some: { userId } } } }),

    /** Returns false when no token with that id belongs to the user. */
    deleteForUser: async (userId: string, id: string): Promise<boolean> =>
      (await prisma.accessToken.deleteMany({ where: { id, userId } })).count === 1,

    touchLastUsed: (id: string, at: Date) =>
      prisma.accessToken.updateMany({
        where: {
          id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(at.getTime() - LAST_USED_RESOLUTION_MS) } }],
        },
        data: { lastUsedAt: at },
      }),
  };
}

export type TokensRepository = ReturnType<typeof createTokensRepository>;
