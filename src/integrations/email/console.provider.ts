import type { Logger } from "../../lib/logger.js";
import type { EmailProvider } from "./email.types.js";

/** Writes emails to the log instead of sending them, so links can be copied during development. */
export function createConsoleEmailProvider(logger: Logger): EmailProvider {
  return {
    name: "console",
    send: (message) => {
      logger.info({ email: { to: message.to, subject: message.subject, text: message.text } }, "email (not sent)");
      return Promise.resolve();
    },
  };
}
