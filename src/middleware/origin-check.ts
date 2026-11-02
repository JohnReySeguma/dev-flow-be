import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { readSessionCookies } from "../modules/auth/auth.cookies.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for cookie-authenticated writes, on top of SameSite=Lax cookies.
 * Browsers always send `Origin` on writes, so a write must come from the frontend's origin.
 * A write without `Origin` is only accepted when it carries no session cookies (curl,
 * scripts), and bearer tokens are never sent automatically, so they are exempt.
 */
export function originCheck(allowedOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get("authorization")?.startsWith("Bearer ")) {
      next();
      return;
    }
    const origin = req.get("origin");
    const { accessToken, refreshToken } = readSessionCookies(req);
    if (origin ? origin !== allowedOrigin : Boolean(accessToken ?? refreshToken)) {
      throw new AppError("FORBIDDEN", "Cross-site request blocked: writes must come from the DevFlow app.");
    }
    next();
  };
}
