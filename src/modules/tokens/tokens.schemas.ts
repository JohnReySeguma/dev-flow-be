import { z } from "zod";
import { pageOf } from "../../lib/pagination.js";

/** Matches the frontend's TokenScope (lib/account-data.ts). */
export const TOKEN_SCOPES = ["issues:read", "issues:write", "projects:admin", "webhooks:manage"] as const;
export const tokenScope = z.enum(TOKEN_SCOPES);
export type TokenScope = z.infer<typeof tokenScope>;

/** The frontend's AccessToken (lib/account-data.ts). The secret itself is never returned after creation. */
export const accessToken = z
  .object({
    id: z.uuid(),
    name: z.string(),
    lastFour: z.string(),
    workspace: z
      .object({ id: z.uuid(), slug: z.string(), name: z.string() })
      .meta({ description: "The only workspace the token works in." }),
    scopes: z.array(tokenScope),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .meta({
    id: "AccessToken",
    example: {
      id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e10",
      name: "devflow-cli · MacBook Pro",
      lastFour: "q7Rk",
      workspace: { id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e00", slug: "acme-inc", name: "Acme Inc" },
      scopes: ["issues:read", "issues:write"],
      createdAt: "2026-08-14T10:00:00.000Z",
      lastUsedAt: "2026-11-01T08:41:00.000Z",
      expiresAt: null,
    },
  });

export const createTokenBody = z
  .object({
    name: z.string().trim().min(1, "Name the token.").max(64, "Use at most 64 characters."),
    scopes: z
      .array(tokenScope)
      .min(1, "Pick at least one scope.")
      .transform((scopes) => [...new Set(scopes)]),
    expiresInDays: z.number().int().min(1).max(365).nullable(),
    workspace: z
      .string()
      .min(1, "Pick the workspace the token works in.")
      .max(64)
      .meta({ description: "Slug of the workspace the token works in; you must be a member." }),
  })
  .meta({
    id: "CreateAccessTokenRequest",
    example: {
      name: "GitHub Actions · release.yml",
      scopes: ["issues:write"],
      expiresInDays: 30,
      workspace: "acme-inc",
    },
  });

export const createTokenResponse = z
  .object({
    token: accessToken,
    secret: z.string().meta({ description: "Shown once. Use as `Authorization: Bearer <secret>`." }),
  })
  .meta({
    id: "CreatedAccessToken",
    example: {
      token: accessToken.meta()?.example,
      secret: "dfp_YOUR_ACCESS_TOKEN",
    },
  });

export const accessTokenPage = pageOf(accessToken).meta({
  id: "AccessTokenPage",
  example: { items: [accessToken.meta()?.example], nextCursor: null },
});

export type AccessTokenView = z.infer<typeof accessToken>;
export type CreateTokenInput = z.infer<typeof createTokenBody>;
