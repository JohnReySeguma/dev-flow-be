import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, ERROR_CATALOGUE, fieldErrorsFrom, problemType, type ProblemDetails } from "../lib/errors.js";

/** Errors raised by body-parser and other http-errors based middleware. */
type HttpError = Error & { status?: number; type?: string; expose?: boolean };

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError("VALIDATION_FAILED", "The request contains invalid fields.", {
      errors: fieldErrorsFrom(error),
      cause: error,
    });
  }
  const httpError = error as HttpError;
  if (httpError.type === "entity.parse.failed") {
    return new AppError("BAD_REQUEST", "The request body is not valid JSON.", { cause: error });
  }
  if (httpError.type === "entity.too.large") return new AppError("PAYLOAD_TOO_LARGE", undefined, { cause: error });
  if (httpError.expose && httpError.status === 400) return new AppError("BAD_REQUEST", undefined, { cause: error });
  // Anything else is a bug: never leak its message to the client.
  return new AppError("INTERNAL_ERROR", "Something went wrong. Quote the request id when reporting it.", {
    cause: error,
  });
}

/** Turns every error into an RFC 9457 `application/problem+json` response. */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  const appError = toAppError(error);
  if (appError.status >= 500) req.log.error({ err: error }, "request failed");
  if (res.headersSent) {
    next(error);
    return;
  }

  const problem: ProblemDetails = {
    type: problemType(appError.code),
    title: ERROR_CATALOGUE[appError.code].title,
    status: appError.status,
    detail: appError.message,
    instance: req.originalUrl,
    code: appError.code,
    requestId: typeof req.id === "string" ? req.id : "unknown",
    ...(appError.errors && { errors: appError.errors }),
  };
  res.status(problem.status).type("application/problem+json").json(problem);
};

/** Catch-all for unmatched routes; must be registered after every router. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError("NOT_FOUND", `No route matches ${req.method} ${req.path}.`));
};
