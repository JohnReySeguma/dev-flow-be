import { z } from "zod";
import { ERROR_CATALOGUE, type ErrorCode } from "../lib/errors.js";

const errorCodes = Object.keys(ERROR_CATALOGUE) as [ErrorCode, ...ErrorCode[]];

/** OpenAPI view of `ProblemDetails` in lib/errors.ts. */
export const problemDetails = z
  .object({
    type: z.string().meta({ description: "`urn:devflow:error:<code>`" }),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string().meta({ description: "The request path." }),
    code: z.enum(errorCodes).meta({ description: "Stable machine-readable code; see docs/INTEGRATION.md." }),
    requestId: z.string().meta({ description: "Matches the X-Request-Id response header." }),
    errors: z
      .array(z.object({ field: z.string(), message: z.string() }))
      .optional()
      .meta({ description: "Present on 422 VALIDATION_FAILED only." }),
  })
  .meta({
    id: "ProblemDetails",
    description: "RFC 9457 problem details, served as application/problem+json.",
    example: {
      type: "urn:devflow:error:SPRINT_ALREADY_ACTIVE",
      title: "Another sprint is already active",
      status: 409,
      detail: "Sprint 25 is already active in DEV.",
      instance: "/api/v1/sprints/0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e6f/start",
      code: "SPRINT_ALREADY_ACTIVE",
      requestId: "6f1c2a9e-3b7d-4c8e-9f0a-1b2c3d4e5f60",
    },
  });

/** The `default` response every operation shares. */
export const problemResponse = {
  description: "Error, as RFC 9457 problem details.",
  content: { "application/problem+json": { schema: problemDetails } },
};
