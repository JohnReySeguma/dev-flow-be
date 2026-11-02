import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedTeam } from "./helpers/team.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, email, close } = createTestApp();
afterAll(close);

let admin: ReturnType<typeof asBrowser>;
beforeEach(async () => {
  await truncateAll(prisma);
  await seedTeam(prisma, createLogger(env), undefined, { tracker: false });
  email.sent.length = 0;
  email.failNext = false;
  admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
});

const tokenFrom = (text = "") => decodeURIComponent(/\/invite\?token=(\S+)/.exec(text)?.[1] ?? "");

describe("POST /api/v2/workspaces/acme-inc/invites", () => {
  it("creates a pending invite and emails a link to the frontend's invite page", async () => {
    const res = await admin
      .post("/api/v2/workspaces/acme-inc/invites")
      .send({ email: "Grace@Acme.dev", role: "member" });

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
    await admin.post("/api/v2/workspaces/acme-inc/invites").send({ email: "grace@acme.dev", role: "member" });

    const member = await admin
      .post("/api/v2/workspaces/acme-inc/invites")
      .send({ email: "MEMBER@devflow.local", role: "viewer" });
    const pending = await admin
      .post("/api/v2/workspaces/acme-inc/invites")
      .send({ email: "grace@acme.dev", role: "viewer" });

    for (const res of [member, pending]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ALREADY_MEMBER");
    }
    expect(email.sent).toHaveLength(1);
  });

  it("keeps the invite and reports EMAIL_DELIVERY_FAILED when the email cannot be sent", async () => {
    email.failNext = true;

    const res = await admin
      .post("/api/v2/workspaces/acme-inc/invites")
      .send({ email: "grace@acme.dev", role: "member" });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("EMAIL_DELIVERY_FAILED");
    expect(await prisma.workspaceInvite.count()).toBe(1);
  });

  it("is admin-only", async () => {
    const member = asBrowser(app, await signIn(app, "member@devflow.local"));

    expect(
      (await member.post("/api/v2/workspaces/acme-inc/invites").send({ email: "x@acme.dev", role: "member" })).status,
    ).toBe(403);
  });

  it("validates the email and role", async () => {
    const res = await admin.post("/api/v2/workspaces/acme-inc/invites").send({ email: "nope", role: "owner" });

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(["email", "role"]);
  });
});

describe("POST /api/v2/workspaces/acme-inc/invites/:id/resend", () => {
  it("emails a new link and retires the old one", async () => {
    const created = await admin
      .post("/api/v2/workspaces/acme-inc/invites")
      .send({ email: "grace@acme.dev", role: "member" });
    const firstHash = (await prisma.workspaceInvite.findFirstOrThrow()).tokenHash;

    const res = await admin.post(`/api/v2/workspaces/acme-inc/invites/${created.body.id}/resend`);

    expect(res.status).toBe(200);
    expect(email.sent).toHaveLength(2);
    expect(tokenFrom(email.sent[1]?.text)).not.toBe(tokenFrom(email.sent[0]?.text));
    expect((await prisma.workspaceInvite.findFirstOrThrow()).tokenHash).not.toBe(firstHash);
  });

  it("is 404 for an unknown invite or a member id", async () => {
    const member = await prisma.user.findUniqueOrThrow({ where: { email: "member@devflow.local" } });

    expect((await admin.post(`/api/v2/workspaces/acme-inc/invites/${member.id}/resend`)).status).toBe(404);
    expect((await admin.post("/api/v2/workspaces/acme-inc/invites/nope/resend")).status).toBe(404);
  });
});

describe("accepting an invite", () => {
  async function invite(address = "grace@acme.dev", role = "viewer") {
    await admin.post("/api/v2/workspaces/acme-inc/invites").send({ email: address, role });
    return tokenFrom(email.sent.at(-1)?.text);
  }
  const preview = (token: string) => request(app).get(`/api/v2/invites/${encodeURIComponent(token)}`);
  const accept = (token: string, body: object = { name: "Grace Hopper", password: "compiler-1952" }) =>
    request(app)
      .post(`/api/v2/invites/${encodeURIComponent(token)}/accept`)
      .set("Origin", FRONTEND_ORIGIN)
      .send(body);

  it("previews the invite for the /invite page without signing in", async () => {
    const res = await preview(await invite());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: "grace@acme.dev",
      role: "viewer",
      workspace: { name: "Acme Inc" },
      invitedBy: { name: "John Rey" },
    });
  });

  it("creates the account with the invited role and signs it in", async () => {
    const res = await accept(await invite());

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: "Grace Hopper", email: "grace@acme.dev" });
    expect(res.body.workspaces).toEqual([expect.objectContaining({ slug: "acme-inc", role: "viewer" })]);
    const me = await request(app).get("/api/v2/auth/me").set("Cookie", sessionCookieHeader(res));
    expect(me.status).toBe(200);
    const members = await admin.get("/api/v2/workspaces/acme-inc/members");
    expect(members.body.items.find((m: { email: string }) => m.email === "grace@acme.dev")).toMatchObject({
      status: "active",
      role: "viewer",
    });
  });

  it("works once", async () => {
    const token = await invite();
    await accept(token);

    const again = await accept(token, { name: "Mallory", password: "another-password" });

    expect(again.status).toBe(400);
    expect(again.body.code).toBe("INVITE_INVALID");
  });

  it("rejects expired, unknown and resent-away links", async () => {
    const token = await invite();
    const created = await prisma.workspaceInvite.findFirstOrThrow();
    await admin.post(`/api/v2/workspaces/acme-inc/invites/${created.id}/resend`);

    expect((await accept(token)).body.code).toBe("INVITE_INVALID");
    expect((await preview("made-up")).body.code).toBe("INVITE_INVALID");

    const fresh = tokenFrom(email.sent.at(-1)?.text);
    await prisma.workspaceInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await accept(fresh)).body.code).toBe("INVITE_INVALID");
  });

  it("answers ALREADY_MEMBER when the email signed up in the meantime", async () => {
    const token = await invite();
    await request(app)
      .post("/api/v2/auth/signup")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ name: "Grace", email: "grace@acme.dev", password: "compiler-1952" });

    const res = await accept(token);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_MEMBER");
  });

  it("validates the name and password", async () => {
    const res = await accept(await invite(), { name: "", password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(["name", "password"]);
  });
});
