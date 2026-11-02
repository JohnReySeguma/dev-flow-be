import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { Redis } from "../lib/redis.js";

export type RateLimitRule = { windowMs: number; limit: number };

const MINUTE = 60_000;

/**
 * Requests allowed per client IP and window. Generous for people, tight where a request costs
 * an Argon2 hash or an email, or guesses a secret.
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
  /** Invite emails sent (invite and resend). */
  invites: { windowMs: 60 * MINUTE, limit: 30 },
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
      ...(name === "login" && { keyGenerator: loginKey, skipSuccessfulRequests: true }),
      ...(shared && { store: shared }),
      handler: (req, _res, next) => {
        logger.warn({ limit: name, ip: req.ip, path: req.originalUrl }, "rate limit exceeded");
        next(new AppError("RATE_LIMITED", "Too many requests. Try again later; Retry-After says when."));
      },
    });
  };

  return each(limiter);
}
