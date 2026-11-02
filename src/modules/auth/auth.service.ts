import type { Role, User } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { gradientFor, handleBase, toProfile } from "../users/users.mapper.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { WorkspaceRepository } from "../workspace/workspace.repository.js";
import type { AccessTokens } from "./access-token.js";
import type { AuthRepository } from "./auth.repository.js";
import type { AuthMe, LoginInput, SignupInput } from "./auth.schemas.js";
import type { AuthContext, IssuedSession, RequestMeta } from "./auth.types.js";

/** Absolute session lifetime: after this the user signs in again, however active they are. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Used only when no workspace exists yet (a deployment without demo data). */
const DEFAULT_WORKSPACE_NAME = "DevFlow";

type Deps = {
  users: UsersRepository;
  workspaces: WorkspaceRepository;
  sessions: AuthRepository;
  accessTokens: AccessTokens;
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function createAuthService({ users, workspaces, sessions, accessTokens }: Deps) {
  async function uniqueHandle(email: string): Promise<string> {
    const base = handleBase(email);
    for (let suffix = 1; ; suffix++) {
      const candidate = suffix === 1 ? base : `${base}${suffix}`;
      if (!(await users.handleExists(candidate))) return candidate;
    }
  }

  /**
   * Adds a user to the workspace. The first user of an empty workspace becomes its admin;
   * everyone after that joins as a member.
   */
  async function createUser(input: { name: string; email: string; passwordHash: string | null }): Promise<User> {
    const workspace = (await workspaces.findDefault()) ?? (await workspaces.create(DEFAULT_WORKSPACE_NAME));
    const role: Role = (await users.countInWorkspace(workspace.id)) === 0 ? "admin" : "member";
    try {
      return await users.create({
        workspaceId: workspace.id,
        email: input.email,
        name: input.name,
        handle: await uniqueHandle(input.email),
        gradient: gradientFor(input.email),
        role,
        passwordHash: input.passwordHash,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError("EMAIL_TAKEN", undefined, { cause: error });
      throw error;
    }
  }

  async function issueSession(user: User, meta: RequestMeta): Promise<IssuedSession> {
    const now = new Date();
    const refreshToken = randomToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const session = await sessions.createSession({
      userId: user.id,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      refreshTokenHash: sha256(refreshToken),
    });
    await users.touchLastActive(user.id, now);
    return { accessToken: accessTokens.sign({ userId: user.id, sessionId: session.id }), refreshToken, expiresAt };
  }

  async function me(userId: string): Promise<AuthMe> {
    const user = await users.findById(userId);
    const workspace = user && (await workspaces.findById(user.workspaceId));
    if (!user || !workspace) throw new AppError("UNAUTHENTICATED");
    return { user: toProfile(user), workspace: { id: workspace.id, name: workspace.name } };
  }

  return {
    createUser,
    issueSession,
    me,

    async signup(input: SignupInput, meta: RequestMeta) {
      if (await users.findByEmail(input.email)) throw new AppError("EMAIL_TAKEN");
      const user = await createUser({ ...input, passwordHash: await hashPassword(input.password) });
      return { session: await issueSession(user, meta), me: await me(user.id) };
    },

    async login(input: LoginInput, meta: RequestMeta) {
      const user = await users.findByEmail(input.email);
      // Always verify, even for unknown emails, so timing does not reveal which accounts exist.
      if (!(await verifyPassword(user?.passwordHash, input.password)) || !user) {
        throw new AppError("INVALID_CREDENTIALS");
      }
      return { session: await issueSession(user, meta), me: await me(user.id) };
    },

    /** Revokes the session behind either cookie. Idempotent: signing out twice is fine. */
    async logout(cookies: { accessToken?: string; refreshToken?: string }): Promise<void> {
      let sessionId: string | null = null;
      if (cookies.accessToken) {
        try {
          sessionId = accessTokens.verify(cookies.accessToken, { ignoreExpiration: true }).sessionId;
        } catch {
          // A forged or garbled cookie: fall back to the refresh token.
        }
      }
      if (!sessionId && cookies.refreshToken) {
        sessionId = await sessions.findSessionIdByRefreshHash(sha256(cookies.refreshToken));
      }
      if (sessionId) await sessions.revokeSession(sessionId, new Date());
    },

    /** Resolves an access token to the caller, rejecting revoked or expired sessions. */
    async authenticate(accessToken: string): Promise<AuthContext> {
      const { userId, sessionId } = accessTokens.verify(accessToken);
      const session = await sessions.findSessionWithUser(sessionId);
      if (session?.userId !== userId || session.revokedAt || session.expiresAt <= new Date()) {
        throw new AppError("UNAUTHENTICATED");
      }
      return {
        userId,
        workspaceId: session.user.workspaceId,
        role: session.user.role,
        via: "session",
        sessionId,
      };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
