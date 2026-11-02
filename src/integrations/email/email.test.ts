import nodemailer from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../lib/logger.js";
import { createConsoleEmailProvider } from "./console.provider.js";
import { createSmtpEmailProvider } from "./smtp.provider.js";

const message = {
  to: "demo@devflow.local",
  subject: "Reset your DevFlow password",
  text: "Open http://localhost:3000/reset-password?token=abc",
  html: "<p>Open the link</p>",
};

describe("console email provider", () => {
  it("logs the message instead of sending it", async () => {
    const info = vi.fn();
    await createConsoleEmailProvider({ info } as unknown as Logger).send(message);

    expect(info).toHaveBeenCalledWith(
      { email: { to: message.to, subject: message.subject, text: message.text } },
      "email (not sent)",
    );
  });
});

describe("smtp email provider", () => {
  it("sends from the configured address", async () => {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const sendMail = vi.spyOn(transporter, "sendMail");

    await createSmtpEmailProvider(transporter, "DevFlow <no-reply@devflow.local>").send(message);

    expect(sendMail).toHaveBeenCalledWith({ from: "DevFlow <no-reply@devflow.local>", ...message });
  });
});
