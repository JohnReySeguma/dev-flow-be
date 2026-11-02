import type { EmailMessage } from "./email.types.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function passwordResetEmail(input: {
  to: string;
  name: string;
  link: string;
  expiresInMinutes: number;
}): EmailMessage {
  const greeting = `Hi ${input.name},`;
  const body = `Someone asked to reset the password for your DevFlow account. The link works once and expires in ${input.expiresInMinutes} minutes.`;
  const ignore = "If it wasn't you, ignore this email: your password stays the same.";
  return {
    to: input.to,
    subject: "Reset your DevFlow password",
    text: `${greeting}\n\n${body}\n\n${input.link}\n\n${ignore}\n`,
    html:
      `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p>` +
      `<p><a href="${escapeHtml(input.link)}">Choose a new password</a></p><p>${escapeHtml(ignore)}</p>`,
  };
}
