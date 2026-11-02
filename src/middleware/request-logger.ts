import { pinoHttp, type StdSerializedResults } from "pino-http";
import type { Logger } from "../lib/logger.js";
import { resolveRequestId } from "./request-id.js";

/**
 * Removes bearer values that travel in URLs: invite tokens in the path, and OAuth `code`,
 * `state` and any `token` query parameter.
 */
export function redactUrl(url: string): string {
  return url
    .replace(/(\/invites\/)[^/?#]+/g, "$1[redacted]")
    .replace(/([?&](?:code|state|token)=)[^&#]*/g, "$1[redacted]");
}

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
    autoLogging: { ignore: (req) => req.url?.startsWith("/api/v2/health") ?? false },
    // pino-http hands custom serializers the already-serialized request.
    serializers: { req: (req: StdSerializedResults["req"]) => ({ ...req, url: redactUrl(req.url) }) },
  });
}
