import type { Request, RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { readSessionCookies } from "../modules/auth/auth.cookies.js";
import type { AuthService } from "../modules/auth/auth.service.js";
import type { AuthContext } from "../modules/auth/auth.types.js";

/** Rejects anonymous requests with 401 and attaches the caller to `req.auth`. */
export function requireAuth(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const { accessToken } = readSessionCookies(req);
    if (!accessToken) throw new AppError("UNAUTHENTICATED");
    req.auth = await auth.authenticate(accessToken);
    next();
  };
}

/** The caller on a route behind `requireAuth`. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new AppError("UNAUTHENTICATED");
  return req.auth;
}
