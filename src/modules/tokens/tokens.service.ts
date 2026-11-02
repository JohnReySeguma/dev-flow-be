import { z } from "zod";
import type { AccessToken } from "../../generated/prisma/client.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { decodeCursor, toPage, type Page, type PaginationQuery } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { TokensRepository } from "./tokens.repository.js";
import { tokenScope, type AccessTokenView, type CreateTokenInput, type TokenScope } from "./tokens.schemas.js";

export const TOKEN_PREFIX = "dfp_";
const DAY_MS = 24 * 60 * 60 * 1000;

function toView(token: AccessToken): AccessTokenView {
  return {
    id: token.id,
    name: token.name,
    lastFour: token.lastFour,
    // Stored as text[]; drop anything that is no longer a known scope.
    scopes: token.scopes.filter((scope): scope is TokenScope => tokenScope.safeParse(scope).success),
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    expiresAt: token.expiresAt?.toISOString() ?? null,
  };
}

export function createTokensService(tokens: TokensRepository) {
  return {
    async list(userId: string, query: PaginationQuery): Promise<Page<AccessTokenView>> {
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      return toPage(await tokens.listForUser(userId, query.limit, cursor), query.limit, toView);
    },

    /** Returns the secret exactly once; only its hash is stored. */
    /** The token works only in `workspaceId`, the workspace it was created in. */
    async create(
      auth: { userId: string; workspaceId: string },
      input: CreateTokenInput,
    ): Promise<{ token: AccessTokenView; secret: string }> {
      const secret = `${TOKEN_PREFIX}${randomToken(30)}`;
      const token = await tokens.create({
        userId: auth.userId,
        workspaceId: auth.workspaceId,
        name: input.name,
        tokenHash: sha256(secret),
        lastFour: secret.slice(-4),
        scopes: input.scopes,
        expiresAt: input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * DAY_MS),
      });
      return { token: toView(token), secret };
    },

    async revoke(userId: string, id: string): Promise<void> {
      if (!z.uuid().safeParse(id).success || !(await tokens.deleteForUser(userId, id))) {
        throw new AppError("NOT_FOUND", "Access token not found.");
      }
    },

    /**
     * Resolves a bearer secret to its owner in the token's workspace; expired or unknown tokens,
     * and tokens whose owner has left that workspace, are rejected.
     */
    async authenticate(secret: string): Promise<AuthContext> {
      const now = new Date();
      const token = secret.startsWith(TOKEN_PREFIX) ? await tokens.findByHash(sha256(secret)) : null;
      if (!token) throw new AppError("UNAUTHENTICATED", "Invalid access token.");
      if (token.expiresAt && token.expiresAt <= now)
        throw new AppError("UNAUTHENTICATED", "This access token has expired.");
      const membership = await tokens.findOwnerMembership(token.workspaceId, token.userId);
      if (!membership) throw new AppError("UNAUTHENTICATED", "Invalid access token.");
      await tokens.touchLastUsed(token.id, now);
      return {
        userId: token.userId,
        workspaceId: token.workspaceId,
        role: membership.role,
        via: "token",
        tokenId: token.id,
        scopes: toView(token).scopes,
      };
    },
  };
}

export type TokensService = ReturnType<typeof createTokensService>;
