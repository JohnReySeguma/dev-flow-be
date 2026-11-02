import type { Role } from "../../generated/prisma/client.js";
import type { TokenScope } from "../tokens/tokens.schemas.js";

/**
 * Who is calling, from the session cookie or an access token; attached to `req.identity` by
 * `requireAuth`. An access token works in one workspace only, `tokenWorkspaceId`.
 */
export type Identity =
  | { userId: string; via: "session"; sessionId: string }
  | { userId: string; via: "token"; tokenId: string; scopes: TokenScope[]; tokenWorkspaceId: string };

/** The workspace a request acts in. */
export type WorkspaceRef = { id: string; slug: string; name: string; isDemo: boolean };

/**
 * The caller inside one workspace, with their role there; attached to `req.auth` by
 * `requireMembership` on every /workspaces/:ws route.
 */
export type AuthContext = Identity & { workspaceId: string; role: Role; workspace: WorkspaceRef };

export type RequestMeta = { userAgent: string | undefined };

/** A freshly issued session: both cookie values and when the session ends. */
export type IssuedSession = { accessToken: string; refreshToken: string; expiresAt: Date };
