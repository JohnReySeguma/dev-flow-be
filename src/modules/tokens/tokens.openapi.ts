import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";
import { problemResponse } from "../../openapi/problem.js";
import { accessTokenPage, createTokenBody, createTokenResponse } from "./tokens.schemas.js";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });

export function registerTokensDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/me/tokens",
    tags: ["Access tokens"],
    summary: "Your personal access tokens",
    description: "Newest first. Session only: 403 FORBIDDEN with a bearer token.",
    security: [{ cookieAuth: [] }],
    request: { query: paginationQuery },
    responses: { 200: { description: "A page of tokens.", ...json(accessTokenPage) }, default: problemResponse },
  });
  registry.registerPath({
    method: "post",
    path: "/me/tokens",
    tags: ["Access tokens"],
    summary: "Generate a token",
    description:
      "The secret is returned once and never again; only its hash and last four characters are stored. " +
      "expiresInDays: 1 to 365, or null for no expiry. Session only.",
    security: [{ cookieAuth: [] }],
    request: { body: json(createTokenBody) },
    responses: { 201: { description: "Created.", ...json(createTokenResponse) }, default: problemResponse },
  });
  registry.registerPath({
    method: "delete",
    path: "/me/tokens/{id}",
    tags: ["Access tokens"],
    summary: "Revoke a token",
    description: "Takes effect immediately. 404 NOT_FOUND if it is not one of your tokens. Session only.",
    security: [{ cookieAuth: [] }],
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 204: { description: "Revoked." }, default: problemResponse },
  });
}
