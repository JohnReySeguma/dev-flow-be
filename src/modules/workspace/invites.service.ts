import { z } from "zod";
import { Prisma, type WorkspaceInvite } from "../../generated/prisma/client.js";
import type { EmailProvider } from "../../integrations/email/index.js";
import { inviteEmail } from "../../integrations/email/templates.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { hashPassword } from "../../lib/password.js";
import type { AuthMe } from "../auth/auth.schemas.js";
import type { AuthService } from "../auth/auth.service.js";
import type { AuthContext, Identity, IssuedSession, RequestMeta } from "../auth/auth.types.js";
import type { UsersRepository } from "../users/users.repository.js";
import { memberFromInvite, toWorkspaceView } from "./workspace.mapper.js";
import type { WorkspaceRepository } from "./workspace.repository.js";
import type { AcceptInviteInput, InviteInput, InvitePreview, TeamMember, WorkspaceView } from "./workspace.schemas.js";

export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type Deps = {
  workspaces: WorkspaceRepository;
  auth: AuthService;
  users: UsersRepository;
  email: EmailProvider;
  logger: Logger;
  /** The frontend origin; the emailed link opens its /invite page. */
  frontendUrl: string;
  /**
   * Whether inviting needs a verified email. Only while email is really delivered: otherwise
   * nobody could verify, and invite links only reach the server log.
   */
  requireVerifiedEmail: boolean;
};

const alreadyMember = (email: string) => new AppError("ALREADY_MEMBER", `${email} is already on this workspace.`);

const invalidInvite = () =>
  new AppError("INVITE_INVALID", "This invite link is invalid, already used or expired. Ask an admin for a new one.");

export function createInvitesService({
  workspaces,
  auth: accounts,
  users,
  email,
  logger,
  frontendUrl,
  requireVerifiedEmail,
}: Deps) {
  /** Invite emails go to addresses the sender chose, so senders must have proven their own first. */
  async function assertCanSend(auth: AuthContext) {
    if (!requireVerifiedEmail) return;
    const sender = await users.findById(auth.userId);
    if (!sender?.emailVerifiedAt) {
      throw new AppError("EMAIL_UNVERIFIED", "Verify your email address before inviting people. Check your inbox.");
    }
  }

  async function findValid(token: string) {
    const invite = await workspaces.findInviteByTokenHash(sha256(token));
    if (!invite || invite.expiresAt <= new Date()) throw invalidInvite();
    return invite;
  }

  const newToken = () => {
    const token = randomToken();
    return { token, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS) };
  };

  /** Emails the link. The invite is kept if delivery fails, so the admin can resend it. */
  async function sendInvite(auth: AuthContext, invite: WorkspaceInvite, token: string): Promise<void> {
    const inviter = await users.findById(auth.userId);
    try {
      await email.send(
        inviteEmail({
          to: invite.email,
          inviterName: inviter?.name ?? null,
          workspaceName: auth.workspace.name,
          role: invite.role,
          link: `${frontendUrl}/invite?token=${encodeURIComponent(token)}`,
          expiresInDays: INVITE_TTL_DAYS,
        }),
      );
    } catch (error) {
      logger.error({ err: error, inviteId: invite.id }, "invite email failed");
      throw new AppError("EMAIL_DELIVERY_FAILED", "The invite was saved but its email could not be sent. Try Resend.", {
        cause: error,
      });
    }
  }

  return {
    /** Invites anyone who is not yet a member: new people accept, people with an account join. */
    async invite(auth: AuthContext, input: InviteInput): Promise<TeamMember> {
      await assertCanSend(auth);
      if (
        (await workspaces.isMemberByEmail(auth.workspaceId, input.email)) ||
        (await workspaces.findInviteByEmail(auth.workspaceId, input.email))
      ) {
        throw alreadyMember(input.email);
      }
      const { token, tokenHash, expiresAt } = newToken();
      let invite: WorkspaceInvite;
      try {
        invite = await workspaces.createInvite({
          workspaceId: auth.workspaceId,
          email: input.email,
          role: input.role,
          tokenHash,
          invitedById: auth.userId,
          expiresAt,
        });
      } catch (error) {
        // Two admins inviting the same address at once: the unique index decides.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw alreadyMember(input.email);
        }
        throw error;
      }
      await sendInvite(auth, invite, token);
      return memberFromInvite(invite);
    },

    /**
     * What the /invite page shows: the workspace, and whether the email already has an account
     * (sign in and join) or not (accept). Public: the token is the credential.
     */
    async preview(token: string): Promise<InvitePreview> {
      const invite = await findValid(token);
      return {
        email: invite.email,
        role: invite.role,
        workspace: { name: invite.workspace.name, slug: invite.workspace.slug },
        invitedBy: invite.invitedBy ? { name: invite.invitedBy.name } : null,
        expiresAt: invite.expiresAt.toISOString(),
        accountExists: (await users.findByEmail(invite.email)) !== null,
      };
    },

    /**
     * Creates the invitee's account, a member of the inviting workspace only, and signs them in.
     * The emailed link proves the address, so the account starts verified.
     */
    async accept(
      token: string,
      input: AcceptInviteInput,
      meta: RequestMeta,
    ): Promise<{ session: IssuedSession; me: AuthMe }> {
      const invite = await findValid(token);
      if (await users.findByEmail(invite.email)) {
        throw new AppError("EMAIL_TAKEN", `${invite.email} already has a DevFlow account. Sign in with it to join.`);
      }
      if (!(await workspaces.claimInvite(invite.id, invite.tokenHash))) throw invalidInvite();

      const user = await accounts.createUser({
        name: input.name,
        email: invite.email,
        passwordHash: await hashPassword(input.password),
        membership: { workspaceId: invite.workspaceId, role: invite.role },
        emailVerifiedAt: new Date(),
      });
      return { session: await accounts.issueSession(user, meta), me: await accounts.me(user.id) };
    },

    /**
     * Adds the signed-in account to the inviting workspace with the invited role. The account's
     * email must be the invited one; holding the emailed link proves it, so it counts as verified.
     */
    async join(identity: Identity, token: string): Promise<WorkspaceView> {
      const invite = await findValid(token);
      const user = await users.findById(identity.userId);
      if (user?.email !== invite.email) {
        throw new AppError(
          "INVITE_EMAIL_MISMATCH",
          `This invite is for ${invite.email}. Sign in with that account to join.`,
        );
      }
      const membership = await workspaces.transaction(async (tx) => {
        if (await tx.isMemberByEmail(invite.workspaceId, invite.email)) {
          await tx.claimInvite(invite.id, invite.tokenHash);
          throw alreadyMember(invite.email);
        }
        if (!(await tx.claimInvite(invite.id, invite.tokenHash))) throw invalidInvite();
        return tx.addMember(invite.workspaceId, user.id, invite.role);
      });
      await users.markEmailVerified(user.id, new Date());
      return toWorkspaceView(membership.workspace, membership.role);
    },

    /** Sends a fresh link; the previous one stops working. */
    async resend(auth: AuthContext, id: string): Promise<TeamMember> {
      await assertCanSend(auth);
      const existing = z.uuid().safeParse(id).success ? await workspaces.findInvite(auth.workspaceId, id) : null;
      if (!existing) throw new AppError("NOT_FOUND", "No pending invite with that id.");
      const { token, tokenHash, expiresAt } = newToken();
      const invite = await workspaces.rotateInviteToken(id, tokenHash, expiresAt);
      await sendInvite(auth, invite, token);
      return memberFromInvite(invite);
    },
  };
}

export type InvitesService = ReturnType<typeof createInvitesService>;
