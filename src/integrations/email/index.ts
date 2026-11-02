import nodemailer from "nodemailer";
import type { Env } from "../../config/env.js";
import type { Logger } from "../../lib/logger.js";
import { createConsoleEmailProvider } from "./console.provider.js";
import type { EmailProvider } from "./email.types.js";
import { createSmtpEmailProvider } from "./smtp.provider.js";

export type { EmailMessage, EmailProvider } from "./email.types.js";

export function createEmailProvider(env: Env, logger: Logger): EmailProvider {
  if (env.EMAIL_PROVIDER !== "smtp") return createConsoleEmailProvider(logger);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return createSmtpEmailProvider(transporter, env.EMAIL_FROM);
}
