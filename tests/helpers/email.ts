import type { EmailMessage, EmailProvider } from "../../src/integrations/email/index.js";

/** Captures emails so tests can read the links in them. Nothing is ever delivered. */
export function createMemoryEmailProvider(): EmailProvider & { sent: EmailMessage[]; failNext: boolean } {
  const provider = {
    name: "memory" as const,
    sent: [] as EmailMessage[],
    /** Set to true to make the next send fail, as an unreachable SMTP server would. */
    failNext: false,
    send: (message: EmailMessage) => {
      if (provider.failNext) {
        provider.failNext = false;
        return Promise.reject(new Error("SMTP connection refused"));
      }
      provider.sent.push(message);
      return Promise.resolve();
    },
  };
  return provider;
}
