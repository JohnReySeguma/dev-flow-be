import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { Redis } from "../lib/redis.js";

export type RateLimitRule = { windowMs: number; limit: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Requests allowed per client IP and window, unless the rule says otherwise. Generous for people,
 * tight where a request costs an Argon2 hash, an email or a copy of the sample data, or guesses a
 * secret.
 */
export const RATE_LIMITS = {
  /** Every API request. */
  api: { windowMs: MINUTE, limit: 600 },
  /** Failed sign-ins per IP and email: password guessing against one account. */
  login: { windowMs: 15 * MINUTE, limit: 10 },
  /** Sign-in, sign-up, password reset and OAuth starts: hashing, emails, account probing. */
  auth: { windowMs: 15 * MINUTE, limit: 50 },
  /** Session refreshes; the frontend needs about four an hour per tab. */
  refresh: { windowMs: 15 * MINUTE, limit: 60 },
  /** New accounts, each with a workspace and a copy of the sample data. */
  signups: { windowMs: HOUR, limit: 10 },
  /** New workspaces per user (POST /workspaces). */
  workspaces: { windowMs: DAY, limit: 10 },
  /** Invite emails sent (invite and resend). */
  invites: { windowMs: HOUR, limit: 30 },
  /** Invite emails per workspace, whoever sends them. */
  workspaceInvites: { windowMs: DAY, limit: 50 },
  /** Invite previews and accepts: guessing invite tokens. */
  inviteTokens: { windowMs: 15 * MINUTE, limit: 30 },
  /** GitHub deliveries. */
  webhook: { windowMs: MINUTE, limit: 300 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;
export type RateLimiters = Record<RateLimitName, RequestHandler>;

const passThrough: RequestHandler = (_req, _res, next) => {
  next();
};

/** The sign-in limit counts per IP *and* email, so one attacker can't lock everyone out. */
function loginKey(req: Request): string {
  const body: unknown = req.body;
  const email = typeof body === "object" && body !== null && "email" in body ? String(body.email) : "";
  return `${ipKeyGenerator(req.ip ?? "")}:${email.trim().toLowerCase()}`;
}

/**
 * Rules counted per something other than the client IP. They run after authentication (and, for
 * workspaces, membership), so nobody can use up someone else's quota.
 */
const KEYS: Partial<Record<RateLimitName, (req: Request) => string>> = {
  login: loginKey,
  workspaces: (req) => `user:${req.identity?.userId ?? ipKeyGenerator(req.ip ?? "")}`,
  workspaceInvites: (req) => `workspace:${req.auth?.workspaceId ?? ipKeyGenerator(req.ip ?? "")}`,
};

/**
 * One limiter per rule, counted in Redis when it is configured (so limits hold across API
 * instances) and in memory otherwise. If Redis fails, requests are let through rather than
 * refused: limits protect the API, they must not take it down.
 * `rules: false` disables limiting (tests that sign in many times).
 */
export function createRateLimiters(deps: {
  redis: Redis | null;
  logger: Logger;
  /** Redis key prefix, so environments sharing a Redis keep separate counts. */
  prefix: string;
  rules?: Partial<typeof RATE_LIMITS> | false;
}): RateLimiters {
  const { redis, logger } = deps;
  const each = (make: (name: RateLimitName) => RequestHandler): RateLimiters => {
    const limiters = {} as RateLimiters;
    for (const name of Object.keys(RATE_LIMITS) as RateLimitName[]) limiters[name] = make(name);
    return limiters;
  };
  if (deps.rules === false) return each(() => passThrough);
  const rules = { ...RATE_LIMITS, ...deps.rules };

  const store = (name: RateLimitName): Store | undefined =>
    redis
      ? new RedisStore({
          prefix: `${deps.prefix}${name}:`,
          sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
        })
      : undefined;

  const limiter = (name: RateLimitName) => {
    const shared = store(name);
    return rateLimit({
      ...rules[name],
      standardHeaders: "draft-7",
      legacyHeaders: false,
      passOnStoreError: true,
      ...(KEYS[name] && { keyGenerator: KEYS[name] }),
      ...(name === "login" && { skipSuccessfulRequests: true }),
      ...(shared && { store: shared }),
      handler: (req, _res, next) => {
        logger.warn({ limit: name, ip: req.ip, path: req.originalUrl }, "rate limit exceeded");
        next(new AppError("RATE_LIMITED", "Too many requests. Try again later; Retry-After says when."));
      },
    });
  };

  return each(limiter);
}
