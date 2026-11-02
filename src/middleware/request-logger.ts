import { pinoHttp } from "pino-http";
import type { Logger } from "../lib/logger.js";
import { resolveRequestId } from "./request-id.js";

/** Assigns `req.id` / `req.log` and logs one line per completed request. */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: resolveRequestId,
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    autoLogging: { ignore: (req) => req.url?.startsWith("/api/v1/health") ?? false },
  });
}
