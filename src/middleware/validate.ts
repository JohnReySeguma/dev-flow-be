import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError, fieldErrorsFrom, type FieldError } from "../lib/errors.js";

type RequestSchemas = { params?: ZodType; query?: ZodType; body?: ZodType };

const LOCATIONS = ["params", "query", "body"] as const;

/**
 * Validates and coerces request input at the edge. Parsed values replace the raw ones, so
 * controllers only ever see data that matched the schema. All failures are reported together
 * as a single 422 `VALIDATION_FAILED` problem.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const errors: FieldError[] = [];
    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location]);
      if (result.success) {
        // Express 5 exposes `req.query` as a getter, so shadow it with an own property.
        Object.defineProperty(req, location, { value: result.data, writable: true, enumerable: true });
      } else {
        errors.push(...fieldErrorsFrom(result.error));
      }
    }
    if (errors.length > 0) throw new AppError("VALIDATION_FAILED", "The request contains invalid fields.", { errors });
    next();
  };
}
