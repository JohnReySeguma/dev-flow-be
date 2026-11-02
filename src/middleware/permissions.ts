import type { RequestHandler } from "express";
import type { Role } from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import type { TokenScope } from "../modules/tokens/tokens.schemas.js";
import { authOf, identityOf } from "./require-auth.js";

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

/** viewer = read-only · member = edit issues and sprints · admin = also members, workflow, project delete. */
export function hasRole(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/**
 * Requires at least `minimum`. The caller's role is read from the database on every request,
 * so a demotion takes effect immediately.
 */
export function requireRole(minimum: Role): RequestHandler {
  return (req, _res, next) => {
    if (!hasRole(authOf(req).role, minimum)) {
      throw new AppError("FORBIDDEN", `This action needs the ${minimum} role.`);
    }
    next();
  };
}

/** Limits personal access tokens to their scopes; signed-in sessions are not scoped. */
export function requireScope(scope: TokenScope): RequestHandler {
  return (req, _res, next) => {
    const auth = identityOf(req);
    if (auth.via === "token" && !auth.scopes.includes(scope)) {
      throw new AppError("FORBIDDEN", `This access token lacks the ${scope} scope.`);
    }
    next();
  };
}
