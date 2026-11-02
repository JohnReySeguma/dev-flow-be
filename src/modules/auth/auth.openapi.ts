import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { problemResponse } from "../../openapi/problem.js";
import { authMeResponse, forgotPasswordBody, loginBody, resetPasswordBody, signupBody } from "./auth.schemas.js";

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
    method: "post",
    path: "/auth/password/forgot",
    tags: ["Auth"],
    summary: "Email a password reset link",
    description:
      "Always 202, whether or not the account exists. The email links to {CORS_ORIGIN}/reset-password?token=…; " +
      "the link works once and expires after 60 minutes.",
    request: { body: json(forgotPasswordBody) },
    responses: { 202: { description: "Accepted." }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/auth/password/reset",
    tags: ["Auth"],
    summary: "Set a new password with the emailed token",
    description:
      "Signs the account out on every device; the user then signs in with the new password. " +
      "Errors: 400 RESET_TOKEN_INVALID, 422 VALIDATION_FAILED.",
    request: { body: json(resetPasswordBody) },
    responses: { 204: { description: "Password changed." }, default: problemResponse },
  });
  const provider = z.enum(["github", "google"]).meta({ description: "Must be enabled (see GET /config)." });
  registry.registerPath({
    method: "get",
    path: "/auth/oauth/{provider}",
    tags: ["Auth"],
    summary: "Start GitHub or Google sign-in",
    description:
      "Navigate the browser here (not fetch). Redirects to the provider; after consent the provider returns to the " +
      "callback, which redirects to {CORS_ORIGIN}{redirect} signed in, or to {CORS_ORIGIN}/login?error=<code> with " +
      "code oauth_denied, oauth_state_mismatch, oauth_email_unverified or oauth_failed. 404 NOT_FOUND when the provider is disabled.",
    request: {
      params: z.object({ provider }),
      query: z.object({
        redirect: z
          .string()
          .optional()
          .meta({ description: "Relative frontend path to land on. Default /projects.", example: "/projects" }),
      }),
    },
    responses: { 302: { description: "Redirect to the provider." }, default: problemResponse },
  });
  registry.registerPath({
    method: "get",
    path: "/auth/oauth/{provider}/callback",
    tags: ["Auth"],
    summary: "OAuth callback (called by the provider)",
    description:
      "Registered with GitHub and Google as {API_URL}/api/v1/auth/oauth/{provider}/callback. Always redirects to the frontend.",
    request: { params: z.object({ provider }) },
    responses: {
      302: { description: "Redirect to the frontend.", headers: setsSessionCookies },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/auth/me",
    tags: ["Auth"],
    summary: "Current user and workspace",
    description:
      "Call on app load. 401 UNAUTHENTICATED → signed out; 401 TOKEN_EXPIRED → call POST /auth/refresh once and retry.",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    responses: { 200: { description: "The signed-in user.", ...json(authMeResponse) }, default: problemResponse },
  });
}
