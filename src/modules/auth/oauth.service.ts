import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { User } from "../../generated/prisma/client.js";
import type { OAuthProviderName, OAuthProviders } from "../../integrations/oauth/index.js";
import { randomToken, safeEqual } from "../../lib/crypto.js";
import type { Logger } from "../../lib/logger.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { AuthRepository } from "./auth.repository.js";
import type { AuthService } from "./auth.service.js";
import type { IssuedSession, RequestMeta } from "./auth.types.js";

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const STATE_AUDIENCE = "devflow-oauth";
const DEFAULT_REDIRECT = "/projects";

/** Appended to `${CORS_ORIGIN}/login?error=` when sign-in fails. Stable: the frontend maps them to messages. */
export const OAUTH_ERROR_CODES = [
  "oauth_denied",
  "oauth_state_mismatch",
  "oauth_email_unverified",
  "oauth_account_locked",
  "oauth_failed",
] as const;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export class OAuthFlowError extends Error {
  override name = "OAuthFlowError";
  constructor(readonly code: OAuthErrorCode) {
    super(code);
  }
}

/**
 * Only same-site relative paths ("/projects/DEV"), never "//evil.example" or absolute URLs,
 * so the sign-in redirect cannot be abused as an open redirect.
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return DEFAULT_REDIRECT;
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return DEFAULT_REDIRECT;
  return value;
}

type StateClaims = { provider: OAuthProviderName; state: string; verifier: string; redirect: string };

type Deps = {
  providers: OAuthProviders;
  auth: AuthService;
  users: UsersRepository;
  sessions: AuthRepository;
  secret: string;
  /** Public API origin; callback URLs are registered with the providers under it. */
  apiUrl: string;
  logger: Logger;
};

export function createOAuthService({ providers, auth, users, sessions, secret, apiUrl, logger }: Deps) {
  const redirectUri = (name: OAuthProviderName) => `${apiUrl}/api/auth/oauth/${name}/callback`;

  function readState(token: string | undefined, name: OAuthProviderName, state: string | undefined): StateClaims {
    try {
      const claims = jwt.verify(token ?? "", secret, {
        algorithms: ["HS256"],
        audience: STATE_AUDIENCE,
      }) as StateClaims;
      if (claims.provider === name && state && safeEqual(claims.state, state)) return claims;
    } catch {
      // Missing, expired or forged state cookie.
    }
    throw new OAuthFlowError("oauth_state_mismatch");
  }

  /**
   * Finds the account by provider identity, then by verified email (claiming it, see below), else
   * creates one.
   */
  async function resolveUser(name: OAuthProviderName, code: string, claims: StateClaims): Promise<User> {
    const provider = providers[name];
    if (!provider) throw new OAuthFlowError("oauth_failed");
    let profile;
    try {
      profile = await provider.fetchProfile({ code, redirectUri: redirectUri(name), codeVerifier: claims.verifier });
    } catch (error) {
      logger.warn({ err: error, provider: name }, "oauth profile fetch failed");
      throw new OAuthFlowError("oauth_failed");
    }

    const linked = await sessions.findUserByOAuthAccount(name, profile.providerAccountId);
    if (linked) return linked;
    if (!profile.email || !profile.emailVerified) throw new OAuthFlowError("oauth_email_unverified");

    const existing = await users.findByEmail(profile.email);
    // Demo accounts belong to everyone: whoever controls the address must not take one over.
    if (existing?.isDemo) throw new OAuthFlowError("oauth_account_locked");
    if (existing?.passwordHash) {
      // Sign-up never verifies email addresses, so whoever set that password may not own the
      // address; the provider just proved who does. Clear the password and sign everyone out, or
      // someone who registered the address first would keep access to the account.
      await users.setPasswordHash(existing.id, null);
      await sessions.revokeAllCredentials(existing.id, new Date());
    }
    // The provider verified the address.
    if (existing) await users.markEmailVerified(existing.id, new Date());
    const user =
      existing ??
      (await auth.createUser({
        name: profile.name.slice(0, 48),
        email: profile.email,
        passwordHash: null,
        emailVerifiedAt: new Date(),
      }));
    await sessions.linkOAuthAccount(user.id, name, profile.providerAccountId);
    return user;
  }

  return {
    // hasOwn, not `in`: "constructor" or "toString" must not count as providers.
    isEnabled: (name: string): name is OAuthProviderName => Object.hasOwn(providers, name),

    /** The provider URL to send the browser to, plus the signed state to keep in a cookie. */
    start(name: OAuthProviderName, redirect: unknown): { url: string; stateToken: string } {
      const provider = providers[name];
      if (!provider) throw new OAuthFlowError("oauth_failed");
      const claims: StateClaims = {
        provider: name,
        state: randomToken(16),
        verifier: randomToken(32),
        redirect: safeRedirect(redirect),
      };
      const codeChallenge = createHash("sha256").update(claims.verifier).digest("base64url");
      return {
        url: provider.authorizationUrl({ state: claims.state, redirectUri: redirectUri(name), codeChallenge }),
        stateToken: jwt.sign(claims, secret, {
          algorithm: "HS256",
          audience: STATE_AUDIENCE,
          expiresIn: OAUTH_STATE_TTL_SECONDS,
        }),
      };
    },

    /** Completes sign-in; throws OAuthFlowError with the code to show on the login page. */
    async finish(
      name: OAuthProviderName,
      query: { code?: unknown; state?: unknown; error?: unknown },
      stateToken: string | undefined,
      meta: RequestMeta,
    ): Promise<{ session: IssuedSession; redirect: string }> {
      const claims = readState(stateToken, name, typeof query.state === "string" ? query.state : undefined);
      if (query.error !== undefined) {
        throw new OAuthFlowError(query.error === "access_denied" ? "oauth_denied" : "oauth_failed");
      }
      if (typeof query.code !== "string" || !query.code) throw new OAuthFlowError("oauth_failed");

      const user = await resolveUser(name, query.code, claims);
      return { session: await auth.issueSession(user, meta), redirect: claims.redirect };
    },
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
