export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** Delivers transactional email. Implementations: console (development) and smtp. */
export type EmailProvider = {
  readonly name: "console" | "smtp" | "memory";
  send: (message: EmailMessage) => Promise<void>;
};
