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

export function verifyEmailEmail(input: {
  to: string;
  name: string;
  link: string;
  expiresInHours: number;
}): EmailMessage {
  const greeting = `Hi ${input.name},`;
  const body = `Confirm that this is your email address to finish setting up DevFlow. The link works once and expires in ${input.expiresInHours} hours.`;
  const ignore = "If you didn't sign up for DevFlow, ignore this email.";
  return {
    to: input.to,
    subject: "Verify your email for DevFlow",
    text: `${greeting}\n\n${body}\n\n${input.link}\n\n${ignore}\n`,
    html:
      `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p>` +
      `<p><a href="${escapeHtml(input.link)}">Verify my email</a></p><p>${escapeHtml(ignore)}</p>`,
  };
}

export function inviteEmail(input: {
  to: string;
  inviterName: string | null;
  workspaceName: string;
  role: string;
  link: string;
  expiresInDays: number;
}): EmailMessage {
  const who = input.inviterName ?? "Someone";
  const body = `${who} invited you to join ${input.workspaceName} on DevFlow as ${input.role === "admin" ? "an" : "a"} ${input.role}. The link works once and expires in ${input.expiresInDays} days.`;
  const ignore = "If you weren't expecting this, you can ignore this email.";
  return {
    to: input.to,
    subject: `Join ${input.workspaceName} on DevFlow`,
    text: `${body}\n\n${input.link}\n\n${ignore}\n`,
    html:
      `<p>${escapeHtml(body)}</p>` +
      `<p><a href="${escapeHtml(input.link)}">Accept the invitation</a></p><p>${escapeHtml(ignore)}</p>`,
  };
}
