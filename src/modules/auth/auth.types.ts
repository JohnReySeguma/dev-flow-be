import type { Role } from "../../generated/prisma/client.js";

/** Who is making the request, attached to `req.auth` by `requireAuth`. */
export type AuthContext = {
  userId: string;
  workspaceId: string;
  role: Role;
  via: "session";
  sessionId: string;
};

export type RequestMeta = { userAgent: string | undefined };

/** A freshly issued session: both cookie values and when the session ends. */
export type IssuedSession = { accessToken: string; refreshToken: string; expiresAt: Date };
