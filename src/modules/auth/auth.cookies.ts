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

export function readSessionCookies(req: Request): { accessToken?: string; refreshToken?: string } {
  const cookies = req.cookies as Record<string, unknown>;
  const access = cookies[ACCESS_COOKIE];
  const refresh = cookies[REFRESH_COOKIE];
  return {
    ...(typeof access === "string" && access && { accessToken: access }),
    ...(typeof refresh === "string" && refresh && { refreshToken: refresh }),
  };
}
