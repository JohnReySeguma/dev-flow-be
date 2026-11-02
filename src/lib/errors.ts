import type { ZodError } from "zod";

/**
 * Every machine-readable error code the API returns. Codes are a stable contract with the
 * frontend (FRONTEND_HANDOFF.md §6): add new ones freely, never rename or repurpose one.
 */
export const ERROR_CATALOGUE = {
  BAD_REQUEST: { status: 400, title: "Malformed request" },
  RESET_TOKEN_INVALID: { status: 400, title: "Reset link is invalid or has expired" },
  INVITE_INVALID: { status: 400, title: "Invite link is invalid or has expired" },
  UNAUTHENTICATED: { status: 401, title: "Authentication required" },
  TOKEN_EXPIRED: { status: 401, title: "Access token expired" },
  INVALID_CREDENTIALS: { status: 401, title: "Invalid email or password" },
  FORBIDDEN: { status: 403, title: "Not allowed" },
  CANNOT_CHANGE_OWN_ROLE: { status: 403, title: "You cannot change your own role" },
  CANNOT_REMOVE_SELF: { status: 403, title: "You cannot remove yourself" },
  NOT_FOUND: { status: 404, title: "Resource not found" },
  EMAIL_TAKEN: { status: 409, title: "Email already registered" },
  PROJECT_KEY_TAKEN: { status: 409, title: "Project key already in use" },
  SPRINT_ALREADY_ACTIVE: { status: 409, title: "Another sprint is already active" },
  SPRINT_NOT_PLANNED: { status: 409, title: "Sprint is not planned" },
  SPRINT_NOT_ACTIVE: { status: 409, title: "Sprint is not active" },
  STATUS_DELETE_BLOCKED: { status: 409, title: "Status cannot be deleted" },
  STATUS_UPDATE_BLOCKED: { status: 409, title: "Status cannot change category" },
  LAST_ADMIN: { status: 409, title: "The workspace needs at least one admin" },
  ALREADY_MEMBER: { status: 409, title: "Already a workspace member" },
  CONFLICT_STALE: { status: 412, title: "Resource changed since it was read" },
  PAYLOAD_TOO_LARGE: { status: 413, title: "Request body too large" },
  VALIDATION_FAILED: { status: 422, title: "Validation failed" },
  RATE_LIMITED: { status: 429, title: "Too many requests" },
  INTERNAL_ERROR: { status: 500, title: "Internal server error" },
  EMAIL_DELIVERY_FAILED: { status: 502, title: "The email could not be sent" },
} as const satisfies Record<string, { status: number; title: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export type FieldError = { field: string; message: string };

/** RFC 9457 problem details, extended with `code`, `requestId` and (for 422) `errors`. */
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: ErrorCode;
  requestId: string;
  errors?: FieldError[];
};

export const problemType = (code: ErrorCode) => `urn:devflow:error:${code}`;

/** An expected failure that maps directly onto a problem+json response. */
export class AppError extends Error {
  override name = "AppError";
  readonly status: number;
  readonly errors: FieldError[] | undefined;

  constructor(
    readonly code: ErrorCode,
    detail: string = ERROR_CATALOGUE[code].title,
    options: { errors?: FieldError[]; cause?: unknown } = {},
  ) {
    super(detail, { cause: options.cause });
    this.status = ERROR_CATALOGUE[code].status;
    this.errors = options.errors;
  }
}

export function fieldErrorsFrom(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({ field: issue.path.join(".") || "(root)", message: issue.message }));
}
