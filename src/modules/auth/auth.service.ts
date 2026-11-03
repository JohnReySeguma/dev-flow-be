import type { Role, User } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { gradientFor, handleBase, toProfile } from "../users/users.mapper.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { WorkspaceRepository } from "../workspace/workspace.repository.js";
import type { AccessTokens } from "./access-token.js";
import type { AuthRepository } from "./auth.repository.js";
import type { AuthMe, LoginInput, SignupInput } from "./auth.schemas.js";
import { toWorkspaceView } from "../workspace/workspace.mapper.js";
import type { Identity, IssuedSession, RequestMeta } from "./auth.types.js";

/** Absolute session lifetime: after this the user signs in again, however active they are. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** "Ada Lovelace" → "Ada Lovelace's workspace". */
export const personalWorkspaceName = (name: string) => `${name}'s workspace`;

type Deps = {
  users: UsersRepository;
  workspaces: WorkspaceRepository;
  sessions: AuthRepository;
  accessTokens: AccessTokens;
  logger: Logger;
  /** Gives a new account that did not come through an invite its own workspace. */
  createPersonalWorkspace: (user: User) => Promise<void>;
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function createAuthService({
  users,
  workspaces,
  sessions,
  accessTokens,
  logger,
  createPersonalWorkspace,
}: Deps) {
  async function uniqueHandle(email: string): Promise<string> {
    const base = handleBase(email);
    for (let suffix = 1; ; suffix++) {
      const candidate = suffix === 1 ? base : `${base}${suffix}`;
      if (!(await users.handleExists(candidate))) return candidate;
    }
  }

  /**
   * Creates an account. With `membership` (an accepted invite) it joins that workspace only;
   * otherwise it gets its own workspace, as admin.
   */
  async function createUser(input: {
    name: string;
    email: string;
    passwordHash: string | null;
    membership?: { workspaceId: string; role: Role };
    emailVerifiedAt?: Date;
  }): Promise<User> {
    let user: User;
    try {
      user = await users.create({
        email: input.email,
        name: input.name,
        handle: await uniqueHandle(input.email),
        gradient: gradientFor(input.email),
        passwordHash: input.passwordHash,
        ...(input.membership && { membership: input.membership }),
        ...(input.emailVerifiedAt && { emailVerifiedAt: input.emailVerifiedAt }),
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError("EMAIL_TAKEN", undefined, { cause: error });
      throw error;
    }
    if (!input.membership) await createPersonalWorkspace(user);
    return user;
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
    const [user, memberships] = await Promise.all([users.findById(userId), workspaces.listMemberships(userId)]);
    if (!user) throw new AppError("UNAUTHENTICATED");
    return { user: toProfile(user), workspaces: memberships.map((m) => toWorkspaceView(m.workspace, m.role)) };
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

    /**
     * Exchanges a refresh token for a new access token and a new refresh token. A token that
     * was already used means it leaked (or two tabs raced): the whole session is revoked.
     */
    async refresh(refreshToken: string): Promise<IssuedSession> {
      const now = new Date();
      const token = await sessions.findRefreshToken(sha256(refreshToken));
      if (!token) throw new AppError("UNAUTHENTICATED");
      if (!(await sessions.claimRefreshToken(token.id, now))) {
        await sessions.revokeSession(token.sessionId, now);
        logger.warn({ sessionId: token.sessionId }, "refresh token reused: session revoked");
        throw new AppError("UNAUTHENTICATED");
      }
      const { session } = token;
      if (session.revokedAt || session.expiresAt <= now) throw new AppError("UNAUTHENTICATED");

      const next = randomToken();
      await sessions.addRefreshToken(session.id, sha256(next));
      await users.touchLastActive(session.userId, now);
      return {
        accessToken: accessTokens.sign({ userId: session.userId, sessionId: session.id }),
        refreshToken: next,
        expiresAt: session.expiresAt,
      };
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
    async authenticate(accessToken: string): Promise<Identity> {
      const { userId, sessionId } = accessTokens.verify(accessToken);
      const session = await sessions.findSession(sessionId);
      if (session?.userId !== userId || session.revokedAt || session.expiresAt <= new Date()) {
        throw new AppError("UNAUTHENTICATED");
      }
      return { userId, isDemo: session.user.isDemo, via: "session", sessionId };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
