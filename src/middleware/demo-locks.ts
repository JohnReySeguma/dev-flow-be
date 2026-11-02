import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { authOf, identityOf } from "./require-auth.js";

/**
 * For changes to the seeded demo workspace that every visitor would see: renaming or deleting it,
 * leaving it, invites and member changes. Issues, sprints and the demo reset stay open.
 */
export const lockedInDemoWorkspace: RequestHandler = (req, _res, next) => {
  if (authOf(req).workspace.isDemo) {
    throw new AppError(
      "DEMO_WORKSPACE_LOCKED",
      "The demo workspace is shared by every visitor, so this is turned off here. Create your own workspace to try it.",
    );
  }
  next();
};

/** For account changes on the seeded demo accounts, whose password is public. */
export const lockedForDemoAccounts: RequestHandler = (req, _res, next) => {
  if (identityOf(req).isDemo) {
    throw new AppError(
      "DEMO_ACCOUNT_LOCKED",
      "Demo accounts are shared by every visitor, so this is turned off. Sign up to get your own account.",
    );
  }
  next();
};
