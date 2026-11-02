import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { problemResponse } from "../../openapi/problem.js";
import { updateProfileBody, userProfile } from "./users.schemas.js";

const etagHeader = {
  ETag: { description: "Version of the profile; send it back as If-Match.", schema: { type: "string" as const } },
};

export function registerUsersDocs(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/me",
    tags: ["Profile"],
    summary: "Your profile",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    responses: {
      200: {
        description: "The signed-in user.",
        headers: etagHeader,
        content: { "application/json": { schema: userProfile } },
      },
      default: problemResponse,
    },
  });
  registry.registerPath({
    method: "patch",
    path: "/me",
    tags: ["Profile"],
    summary: "Update your profile",
    description:
      "Any of name (max 48), gradient (one of the frontend AVATAR_GRADIENTS), timezone (IANA) and bio (max 280). " +
      "Send If-Match with the ETag you read to get 412 CONFLICT_STALE instead of overwriting a newer change. " +
      "Session only: 403 FORBIDDEN with a bearer token.",
    security: [{ cookieAuth: [] }],
    request: {
      headers: z.object({ "If-Match": z.string().optional().meta({ description: "ETag from GET /me." }) }),
      body: { content: { "application/json": { schema: updateProfileBody } } },
    },
    responses: {
      200: {
        description: "The updated profile.",
        headers: etagHeader,
        content: { "application/json": { schema: userProfile } },
      },
      default: problemResponse,
    },
  });
}
