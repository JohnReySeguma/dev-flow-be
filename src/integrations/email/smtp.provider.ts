import type { Transporter } from "nodemailer";
import type { EmailProvider } from "./email.types.js";

/** Sends through an SMTP transporter (e.g. Gmail with an App Password). */
export function createSmtpEmailProvider(transporter: Transporter, from: string): EmailProvider {
  return {
    name: "smtp",
    send: async (message) => {
      await transporter.sendMail({ from, ...message });
    },
  };
}
