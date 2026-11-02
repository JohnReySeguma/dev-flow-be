import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Accept a caller's id (e.g. from a proxy) only if it is short and log-safe. */
const SAFE_ID = /^[\w.:-]{1,128}$/;

/**
 * Reuses an incoming `X-Request-Id` or generates one, and echoes it on the response so a
 * client can quote it when reporting a problem.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const id = typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
