import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser } from "./helpers/session.js";

// Email is delivered here, so unverified accounts cannot invite.
const { app, prisma, email, close } = createTestApp({ env: { EMAIL_PROVIDER: "smtp" } });
afterAll(close);

let ada: ReturnType<typeof asBrowser>;
let slug = "";
beforeEach(async () => {
  await truncateAll(prisma);
  email.sent.length = 0;
  const res = await request(app)
    .post("/api/v2/auth/signup")
    .set("Origin", FRONTEND_ORIGIN)
    .send({ name: "Ada Lovelace", email: "ada@acme.dev", password: "correct horse battery" });
  ada = asBrowser(app, sessionCookieHeader(res));
  slug = res.body.workspaces[0].slug as string;
});

/** Waits for the next verification email and returns the token in its link. */
async function nextVerifyToken(count = 1): Promise<string> {
  await vi.waitFor(() => {
    expect(email.sent.filter((m) => m.text.includes("/verify-email?token="))).toHaveLength(count);
  });
  const message = email.sent.filter((m) => m.text.includes("/verify-email?token=")).at(-1);
  return decodeURIComponent(/\/verify-email\?token=(\S+)/.exec(message?.text ?? "")?.[1] ?? "");
}
const verify = (token: string) =>
  request(app).post("/api/v2/auth/email/verify").set("Origin", FRONTEND_ORIGIN).send({ token });
const verified = async () => (await ada.get("/api/v2/me")).body.emailVerified as boolean;

describe("email verification", () => {
  it("emails a link to the frontend's verify page after a password sign-up", async () => {
    const token = await nextVerifyToken();

    const message = email.sent.at(-1);
    expect(message).toMatchObject({ to: "ada@acme.dev", subject: "Verify your email for DevFlow" });
    expect(message?.text).toContain(`${FRONTEND_ORIGIN}/verify-email?token=`);
    expect(message?.text).toContain("expires in 48 hours");
    expect(token).toHaveLength(43);
    expect(await verified()).toBe(false);
  });

  it("verifies the address once, without signing in", async () => {
    const token = await nextVerifyToken();

    expect((await verify(token)).status).toBe(204);
    expect(await verified()).toBe(true);
    const again = await verify(token);
    expect([again.status, again.body.code]).toEqual([400, "VERIFY_TOKEN_INVALID"]);
  });

  it("rejects unknown and expired links", async () => {
    const token = await nextVerifyToken();
    await prisma.emailVerificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await verify(token)).body.code).toBe("VERIFY_TOKEN_INVALID");
    expect((await verify("made-up")).body.code).toBe("VERIFY_TOKEN_INVALID");
    expect(await verified()).toBe(false);
  });

  it("resends a new link and retires the old one", async () => {
    const first = await nextVerifyToken();

    expect((await ada.post("/api/v2/auth/email/resend")).status).toBe(202);
    const second = await nextVerifyToken(2);

    expect((await verify(first)).body.code).toBe("VERIFY_TOKEN_INVALID");
    expect((await verify(second)).status).toBe(204);
  });

  it("sends nothing to a verified address, and needs a session to resend", async () => {
    await verify(await nextVerifyToken());

    expect((await ada.post("/api/v2/auth/email/resend")).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(email.sent).toHaveLength(1);
    expect((await request(app).post("/api/v2/auth/email/resend").set("Origin", FRONTEND_ORIGIN)).status).toBe(401);
  });

  it("counts a password reset as proof of the address", async () => {
    await nextVerifyToken();
    await request(app)
      .post("/api/v2/auth/password/forgot")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ email: "ada@acme.dev" });
    await vi.waitFor(() => {
      expect(email.sent.some((m) => m.text.includes("/reset-password?token="))).toBe(true);
    });
    const reset = email.sent.find((m) => m.text.includes("/reset-password?token="));
    const token = decodeURIComponent(/reset-password\?token=(\S+)/.exec(reset?.text ?? "")?.[1] ?? "");

    await request(app)
      .post("/api/v2/auth/password/reset")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ token, password: "a brand new password" });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@acme.dev" } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });
});

describe("inviting needs a verified email while email is delivered", () => {
  const invite = () => ada.post(`/api/v2/workspaces/${slug}/invites`).send({ email: "grace@acme.dev", role: "member" });

  it("refuses an unverified sender with EMAIL_UNVERIFIED, and allows them once verified", async () => {
    const token = await nextVerifyToken();

    const before = await invite();
    expect([before.status, before.body.code]).toEqual([403, "EMAIL_UNVERIFIED"]);
    expect(await prisma.workspaceInvite.count()).toBe(0);

    await verify(token);
    expect((await invite()).status).toBe(201);
  });

  it("does not ask for verification when email is only logged", async () => {
    const consoleApp = createTestApp({ env: { EMAIL_PROVIDER: "console" } });
    const res = await request(consoleApp.app)
      .post("/api/v2/auth/signup")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ name: "Grace Hopper", email: "grace@acme.dev", password: "compiler-1952" });
    const grace = asBrowser(consoleApp.app, sessionCookieHeader(res));

    const sent = await grace
      .post(`/api/v2/workspaces/${res.body.workspaces[0].slug as string}/invites`)
      .send({ email: "lin@acme.dev", role: "member" });

    expect(sent.status).toBe(201);
    await consoleApp.close();
  });
});
