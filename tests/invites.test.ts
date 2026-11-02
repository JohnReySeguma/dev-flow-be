import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, email, close } = createTestApp();
afterAll(close);

let admin: ReturnType<typeof asBrowser>;
beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env));
  email.sent.length = 0;
  email.failNext = false;
  admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
});

const tokenFrom = (text = "") => decodeURIComponent(/\/invite\?token=(\S+)/.exec(text)?.[1] ?? "");

describe("POST /api/v1/workspace/invites", () => {
  it("creates a pending invite and emails a link to the frontend's invite page", async () => {
    const res = await admin.post("/api/v1/workspace/invites").send({ email: "Grace@Acme.dev", role: "member" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "grace@acme.dev", role: "member", status: "invited", name: "grace" });
    const message = email.sent.at(-1);
    expect(message?.to).toBe("grace@acme.dev");
    expect(message?.subject).toBe("Join Acme Inc on DevFlow");
    expect(message?.text).toContain("John Rey invited you to join Acme Inc on DevFlow as a member");
    expect(message?.text).toContain(`${FRONTEND_ORIGIN}/invite?token=`);
    expect(tokenFrom(message?.text)).toHaveLength(43);
  });

  it("refuses an existing member or a pending invite with ALREADY_MEMBER", async () => {
    await admin.post("/api/v1/workspace/invites").send({ email: "grace@acme.dev", role: "member" });

    const member = await admin
      .post("/api/v1/workspace/invites")
      .send({ email: "MEMBER@devflow.local", role: "viewer" });
    const pending = await admin.post("/api/v1/workspace/invites").send({ email: "grace@acme.dev", role: "viewer" });

    for (const res of [member, pending]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ALREADY_MEMBER");
    }
    expect(email.sent).toHaveLength(1);
  });

  it("keeps the invite and reports EMAIL_DELIVERY_FAILED when the email cannot be sent", async () => {
    email.failNext = true;

    const res = await admin.post("/api/v1/workspace/invites").send({ email: "grace@acme.dev", role: "member" });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("EMAIL_DELIVERY_FAILED");
    expect(await prisma.workspaceInvite.count()).toBe(1);
  });

  it("is admin-only", async () => {
    const member = asBrowser(app, await signIn(app, "member@devflow.local"));

    expect((await member.post("/api/v1/workspace/invites").send({ email: "x@acme.dev", role: "member" })).status).toBe(
      403,
    );
  });

  it("validates the email and role", async () => {
    const res = await admin.post("/api/v1/workspace/invites").send({ email: "nope", role: "owner" });

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(["email", "role"]);
  });
});

describe("POST /api/v1/workspace/invites/:id/resend", () => {
  it("emails a new link and retires the old one", async () => {
    const created = await admin.post("/api/v1/workspace/invites").send({ email: "grace@acme.dev", role: "member" });
    const firstHash = (await prisma.workspaceInvite.findFirstOrThrow()).tokenHash;

    const res = await admin.post(`/api/v1/workspace/invites/${created.body.id}/resend`);

    expect(res.status).toBe(200);
    expect(email.sent).toHaveLength(2);
    expect(tokenFrom(email.sent[1]?.text)).not.toBe(tokenFrom(email.sent[0]?.text));
    expect((await prisma.workspaceInvite.findFirstOrThrow()).tokenHash).not.toBe(firstHash);
  });

  it("is 404 for an unknown invite or a member id", async () => {
    const member = await prisma.user.findUniqueOrThrow({ where: { email: "member@devflow.local" } });

    expect((await admin.post(`/api/v1/workspace/invites/${member.id}/resend`)).status).toBe(404);
    expect((await admin.post("/api/v1/workspace/invites/nope/resend")).status).toBe(404);
  });
});
