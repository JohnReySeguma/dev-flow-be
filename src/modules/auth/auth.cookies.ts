import type { CookieOptions, Request, Response } from "express";
import type { IssuedSession } from "./auth.types.js";

export const ACCESS_COOKIE = "devflow_access";
export const REFRESH_COOKIE = "devflow_refresh";

// Scoped to the API so the frontend's own server (also on localhost) never receives them;
// the refresh token only travels to the auth endpoints that use it.
const ACCESS_PATH = "/api/v1";
const REFRESH_PATH = "/api/v1/auth";

const base: CookieOptions = { httpOnly: true, secure: true, sameSite: "lax" };

/**
 * Both cookies live as long as the session. The access JWT inside expires after 15 minutes,
 * but keeping the cookie lets the API answer TOKEN_EXPIRED (refresh and retry) instead of
 * UNAUTHENTICATED (signed out).
 */
export function setSessionCookies(res: Response, session: IssuedSession): void {
  const maxAge = Math.max(0, session.expiresAt.getTime() - Date.now());
  res.cookie(ACCESS_COOKIE, session.accessToken, { ...base, path: ACCESS_PATH, maxAge });
  res.cookie(REFRESH_COOKIE, session.refreshToken, { ...base, path: REFRESH_PATH, maxAge });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: ACCESS_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
}

export const OAUTH_STATE_COOKIE = "devflow_oauth";
const OAUTH_PATH = "/api/v1/auth/oauth";

/** Holds the signed OAuth state and PKCE verifier between the redirect and the callback. */
export function setOAuthStateCookie(res: Response, token: string, maxAgeSeconds: number): void {
  res.cookie(OAUTH_STATE_COOKIE, token, { ...base, path: OAUTH_PATH, maxAge: maxAgeSeconds * 1000 });
}

export function clearOAuthStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, { ...base, path: OAUTH_PATH });
}

export function readOAuthStateCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown>)[OAUTH_STATE_COOKIE];
  return typeof value === "string" && value ? value : undefined;
}

export function readSessionCookies(req: Request): { accessToken?: string; refreshToken?: string } {
  const cookies = req.cookies as Record<string, unknown>;
  const access = cookies[ACCESS_COOKIE];
  const refresh = cookies[REFRESH_COOKIE];
  return {
    ...(typeof access === "string" && access && { accessToken: access }),
    ...(typeof refresh === "string" && refresh && { refreshToken: refresh }),
  };
}
