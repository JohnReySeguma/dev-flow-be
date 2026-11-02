import type { EmailProvider } from "../../integrations/email/index.js";
import { passwordResetEmail } from "../../integrations/email/templates.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { hashPassword } from "../../lib/password.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { AuthRepository } from "./auth.repository.js";

export const RESET_TOKEN_TTL_MINUTES = 60;

type Deps = {
  users: UsersRepository;
  sessions: AuthRepository;
  email: EmailProvider;
  logger: Logger;
  /** The frontend origin; the emailed link opens its /reset-password page. */
  frontendUrl: string;
};

export function createPasswordResetService({ users, sessions, email, logger, frontendUrl }: Deps) {
  async function sendResetLink(address: string): Promise<void> {
    const user = await users.findByEmail(address);
    if (!user) return;
    const token = randomToken();
    await sessions.createPasswordResetToken({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
    });
    const link = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await email.send(
      passwordResetEmail({ to: user.email, name: user.name, link, expiresInMinutes: RESET_TOKEN_TTL_MINUTES }),
    );
  }

  return {
    /**
     * Runs in the background and never rejects: the caller answers 202 straight away, so
     * neither the response nor its timing reveals whether the account exists.
     */
    requestReset(address: string): Promise<void> {
      return sendResetLink(address).catch((error: unknown) => {
        logger.error({ err: error }, "password reset email failed");
      });
    },

    /** Sets the new password and signs the account out everywhere. */
    async reset(token: string, password: string): Promise<void> {
      const now = new Date();
      const record = await sessions.findPasswordResetToken(sha256(token));
      if (
        !record ||
        record.usedAt ||
        record.expiresAt <= now ||
        !(await sessions.claimPasswordResetToken(record.id, now))
      ) {
        throw new AppError(
          "RESET_TOKEN_INVALID",
          "This reset link is invalid, already used or expired. Request a new one.",
        );
      }
      await users.setPasswordHash(record.userId, await hashPassword(password));
      await sessions.revokeAllSessions(record.userId, now);
    },
  };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;
