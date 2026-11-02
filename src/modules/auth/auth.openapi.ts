import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { problemResponse } from "../../openapi/problem.js";
import { authMeResponse, loginBody, signupBody } from "./auth.schemas.js";

const setsSessionCookies = {
  "Set-Cookie": {
    description:
      "`devflow_access` (Path=/api/v1) and `devflow_refresh` (Path=/api/v1/auth); both HttpOnly, Secure, SameSite=Lax.",
    schema: { type: "string" as const },
  },
};

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });

export function registerAuthDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "post",
    path: "/auth/signup",
    tags: ["Auth"],
    summary: "Create an account and sign in",
    description:
      "Joins the workspace as a member (the first user of an empty workspace becomes admin). Errors: 409 EMAIL_TAKEN, 422 VALIDATION_FAILED.",
    request: { body: json(signupBody) },
    responses: {
      201: { description: "Signed up and signed in.", headers: setsSessionCookies, ...json(authMeResponse) },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/login",
    tags: ["Auth"],
    summary: "Sign in with email and password",
    description: "Errors: 401 INVALID_CREDENTIALS, 422 VALIDATION_FAILED.",
    request: { body: json(loginBody) },
    responses: {
      200: { description: "Signed in.", headers: setsSessionCookies, ...json(authMeResponse) },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/refresh",
    tags: ["Auth"],
    summary: "Rotate the session tokens",
    description:
      "Uses the devflow_refresh cookie. Call once after a 401 TOKEN_EXPIRED, then retry the request. " +
      "Each refresh token works once: reusing one revokes the whole session, so never run two refreshes at the same time. " +
      "401 UNAUTHENTICATED → signed out (both cookies are cleared).",
    responses: {
      204: { description: "New cookies set.", headers: setsSessionCookies },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/logout",
    tags: ["Auth"],
    summary: "Sign out",
    description: "Revokes the current session and clears both cookies. Succeeds even when already signed out.",
    responses: { 204: { description: "Signed out." }, default: problemResponse },
  });
  registry.registerPath({
    method: "get",
    path: "/auth/me",
    tags: ["Auth"],
    summary: "Current user and workspace",
    description:
      "Call on app load. 401 UNAUTHENTICATED → signed out; 401 TOKEN_EXPIRED → call POST /auth/refresh once and retry.",
    security: [{ cookieAuth: [] }],
    responses: { 200: { description: "The signed-in user.", ...json(authMeResponse) }, default: problemResponse },
  });
}
