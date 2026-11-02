import { pino, type Logger, type LoggerOptions } from "pino";
import type { Env } from "../config/env.js";

export type { Logger };

const LEVELS = { development: "debug", test: "silent", production: "info" } as const;

/** Values that must never reach the logs, even at debug level. */
const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.password",
  "*.token",
  "*.secret",
];

/** JSON lines on stdout in every environment; pretty-printed only during local development. */
export function createLogger(env: Pick<Env, "NODE_ENV">): Logger {
  const options: LoggerOptions = {
    level: LEVELS[env.NODE_ENV],
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  };
  if (env.NODE_ENV === "development") {
    options.transport = { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } };
  }
  return pino(options);
}
