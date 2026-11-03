import type { EmailProvider } from "../../integrations/email/index.js";
import { verifyEmailEmail } from "../../integrations/email/templates.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { AuthRepository } from "./auth.repository.js";

export const VERIFY_TOKEN_TTL_HOURS = 48;

type Deps = {
  users: UsersRepository;
  sessions: AuthRepository;
  email: EmailProvider;
  logger: Logger;
  /** The frontend origin; the emailed link opens its /verify-email page. */
  frontendUrl: string;
};

export function createEmailVerificationService({ users, sessions, email, logger, frontendUrl }: Deps) {
  async function sendLink(userId: string): Promise<void> {
    const user = await users.findById(userId);
    if (!user || user.emailVerifiedAt || user.isDemo) return;
    const token = randomToken();
    await sessions.createEmailVerificationToken({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60_000),
    });
    const link = `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await email.send(
      verifyEmailEmail({ to: user.email, name: user.name, link, expiresInHours: VERIFY_TOKEN_TTL_HOURS }),
    );
  }

  return {
    /**
     * Emails a verification link to an unverified account; nothing for verified or demo accounts.
     * Never rejects: sign-up and resend answer straight away, and a failed email is only logged.
     */
    requestLink(userId: string): Promise<void> {
      return sendLink(userId).catch((error: unknown) => {
        logger.error({ err: error, userId }, "verification email failed");
      });
    },

    /** Marks the address verified. Links work once, and only the newest one works. */
    async verify(token: string): Promise<void> {
      const now = new Date();
      const record = await sessions.findEmailVerificationToken(sha256(token));
      if (
        !record ||
        record.usedAt ||
        record.expiresAt <= now ||
        !(await sessions.claimEmailVerificationToken(record.id, now))
      ) {
        throw new AppError(
          "VERIFY_TOKEN_INVALID",
          "This verification link is invalid, already used or expired. Request a new one.",
        );
      }
      await users.markEmailVerified(record.userId, now);
    },
  };
}

export type EmailVerificationService = ReturnType<typeof createEmailVerificationService>;
