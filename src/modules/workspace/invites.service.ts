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
import type { AuthContext, IssuedSession, RequestMeta } from "../auth/auth.types.js";
import type { UsersRepository } from "../users/users.repository.js";
import { memberFromInvite } from "./workspace.mapper.js";
import type { WorkspaceRepository } from "./workspace.repository.js";
import type { AcceptInviteInput, InviteInput, InvitePreview, TeamMember } from "./workspace.schemas.js";

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
};

const alreadyMember = (email: string) => new AppError("ALREADY_MEMBER", `${email} is already on this workspace.`);

const invalidInvite = () =>
  new AppError("INVITE_INVALID", "This invite link is invalid, already used or expired. Ask an admin for a new one.");

export function createInvitesService({ workspaces, auth: accounts, users, email, logger, frontendUrl }: Deps) {
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
    const [workspace, inviter] = await Promise.all([
      workspaces.findById(auth.workspaceId),
      users.findById(auth.userId),
    ]);
    try {
      await email.send(
        inviteEmail({
          to: invite.email,
          inviterName: inviter?.name ?? null,
          workspaceName: workspace?.name ?? "DevFlow",
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
    async invite(auth: AuthContext, input: InviteInput): Promise<TeamMember> {
      if (
        (await users.findByEmail(input.email)) ??
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

    /** What the /invite page shows before the invitee signs up. Public: the token is the credential. */
    async preview(token: string): Promise<InvitePreview> {
      const invite = await findValid(token);
      return {
        email: invite.email,
        role: invite.role,
        workspace: { name: invite.workspace.name },
        invitedBy: invite.invitedBy ? { name: invite.invitedBy.name } : null,
        expiresAt: invite.expiresAt.toISOString(),
      };
    },

    /** Creates the invitee's account with the invited role and signs them in. */
    async accept(
      token: string,
      input: AcceptInviteInput,
      meta: RequestMeta,
    ): Promise<{ session: IssuedSession; me: AuthMe }> {
      const invite = await findValid(token);
      if (await users.findByEmail(invite.email)) throw alreadyMember(invite.email);
      if (!(await workspaces.claimInvite(invite.id, invite.tokenHash))) throw invalidInvite();

      const user = await accounts.createUser({
        name: input.name,
        email: invite.email,
        passwordHash: await hashPassword(input.password),
        role: invite.role,
      });
      return { session: await accounts.issueSession(user, meta), me: await accounts.me(user.id) };
    },

    /** Sends a fresh link; the previous one stops working. */
    async resend(auth: AuthContext, id: string): Promise<TeamMember> {
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
