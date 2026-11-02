import type { EmailMessage, EmailProvider } from "../../src/integrations/email/index.js";

/** Captures emails so tests can read the links in them. Nothing is ever delivered. */
export function createMemoryEmailProvider(): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    name: "memory",
    sent,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}
