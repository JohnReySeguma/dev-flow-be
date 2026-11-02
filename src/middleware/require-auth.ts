import type { Request, RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { readSessionCookies } from "../modules/auth/auth.cookies.js";
import type { AuthService } from "../modules/auth/auth.service.js";
import type { AuthContext } from "../modules/auth/auth.types.js";
import type { TokensService } from "../modules/tokens/tokens.service.js";

/**
 * Rejects anonymous requests with 401 and attaches the caller to `req.auth`.
 * An Authorization header always wins and never falls back to cookies, which is what makes
 * bearer requests safe to exempt from the origin check.
 */
export function requireAuth(deps: { auth: AuthService; tokens: TokensService }): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get("authorization");
    if (header !== undefined) {
      const [scheme, secret] = header.split(" ");
      if (scheme !== "Bearer" || !secret) throw new AppError("UNAUTHENTICATED", "Use Authorization: Bearer <token>.");
      req.auth = await deps.tokens.authenticate(secret);
    } else {
      const { accessToken } = readSessionCookies(req);
      if (!accessToken) throw new AppError("UNAUTHENTICATED");
      req.auth = await deps.auth.authenticate(accessToken);
    }
    next();
  };
}

/** For account management that a personal access token must not be able to do. */
export const requireSession: RequestHandler = (req, _res, next) => {
  if (authOf(req).via !== "session") {
    throw new AppError("FORBIDDEN", "Sign in to the DevFlow app to do this; access tokens cannot.");
  }
  next();
};

/** The caller on a route behind `requireAuth`. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new AppError("UNAUTHENTICATED");
  return req.auth;
}
