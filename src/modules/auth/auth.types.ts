import type { Role } from "../../generated/prisma/client.js";
import type { TokenScope } from "../tokens/tokens.schemas.js";

type Caller = { userId: string; workspaceId: string; role: Role };

/** Who is making the request, attached to `req.auth` by `requireAuth`. */
export type AuthContext =
  (Caller & { via: "session"; sessionId: string }) | (Caller & { via: "token"; tokenId: string; scopes: TokenScope[] });

export type RequestMeta = { userAgent: string | undefined };

/** A freshly issued session: both cookie values and when the session ends. */
export type IssuedSession = { accessToken: string; refreshToken: string; expiresAt: Date };
