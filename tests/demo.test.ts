import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MEMBERS, seed } from "../prisma/seed.js";
import { restoreDemoWorkspace } from "../src/demo/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, email, close } = createTestApp();
afterAll(close);

const ACME = "/api/v2/workspaces/acme-inc";
let admin: ReturnType<typeof asBrowser>;

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env));
  admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
});

const idOf = async (address: string) => (await prisma.user.findUniqueOrThrow({ where: { email: address } })).id;

describe("the demo workspace", () => {
  it("locks renaming, deleting, leaving, invites and member changes", async () => {
    const dmitri = await idOf("member@devflow.local");
    const member = asBrowser(app, await signIn(app, "member@devflow.local"));

    const attempts = await Promise.all([
      admin.patch(ACME).send({ name: "Pwned Inc" }),
      admin.delete(ACME),
      member.post(`${ACME}/leave`),
      admin.post(`${ACME}/invites`).send({ email: "spam@example.com", role: "member" }),
      admin.patch(`${ACME}/members/${dmitri}`).send({ role: "viewer" }),
      admin.delete(`${ACME}/members/${dmitri}`),
    ]);

    for (const res of attempts) expect([res.status, res.body.code]).toEqual([403, "DEMO_WORKSPACE_LOCKED"]);
    expect(email.sent).toEqual([]);
    expect(await prisma.workspace.findUniqueOrThrow({ where: { slug: "acme-inc" } })).toMatchObject({
      name: "Acme Inc",
    });
    expect(await prisma.workspaceMember.count()).toBe(5);
  });

  it("checks the role before the lock, so viewers still get FORBIDDEN", async () => {
    const viewer = asBrowser(app, await signIn(app, "viewer@devflow.local"));

    expect((await viewer.patch(ACME).send({ name: "x" })).body.code).toBe("FORBIDDEN");
  });

  it("keeps issues, sprints and the demo reset open", async () => {
    const member = asBrowser(app, await signIn(app, "member@devflow.local"));

    expect((await member.post(`${ACME}/projects/DEV/issues`).send({ title: "Try it out" })).status).toBe(201);
    expect((await member.post(`${ACME}/projects/DEV/sprints`)).status).toBe(201);
    expect((await admin.post(`${ACME}/demo/reset`)).status).toBe(204);
  });
});

describe("restoreDemoWorkspace (npm run demo:reset)", () => {
  it("restores the name, the team's roles and memberships, and the projects", async () => {
    const acme = await prisma.workspace.findUniqueOrThrow({ where: { slug: "acme-inc" } });
    const dmitri = await idOf("member@devflow.local");
    await prisma.workspace.update({ where: { id: acme.id }, data: { name: "Defaced" } });
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: acme.id, userId: dmitri } },
      data: { role: "admin" },
    });
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: acme.id, userId: await idOf("viewer@devflow.local") } },
    });
    await admin.delete(`${ACME}/projects/MOB`);
    await admin.post(`${ACME}/projects`).send({ name: "Graffiti", key: "LOL" });

    expect(await restoreDemoWorkspace(prisma, createLogger(env))).toBe(true);

    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: acme.id } })).name).toBe("Acme Inc");
    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: acme.id }, include: { user: true } });
    expect(members.map((m) => [m.user.email, m.role]).sort()).toEqual(
      DEMO_MEMBERS.map((m) => [m.email, m.role]).sort(),
    );
    const projects = await prisma.project.findMany({ where: { workspaceId: acme.id }, orderBy: { createdAt: "asc" } });
    expect(projects.map((p) => p.key).sort()).toEqual(["BIL", "DEV", "MOB"]);
  });

  it("does nothing on a database without a demo workspace", async () => {
    await truncateAll(prisma);

    expect(await restoreDemoWorkspace(prisma, createLogger(env))).toBe(false);
  });
});

describe("the demo accounts", () => {
  it("lock profile edits, access tokens and creating workspaces", async () => {
    const [tokenId] = (await prisma.accessToken.findMany({ select: { id: true } })).map((t) => t.id);

    const attempts = await Promise.all([
      admin.patch("/api/v2/me").send({ name: "Hacked" }),
      admin
        .post("/api/v2/me/tokens")
        .send({ name: "x", scopes: ["issues:read"], expiresInDays: null, workspace: "acme-inc" }),
      admin.delete(`/api/v2/me/tokens/${tokenId ?? ""}`),
      admin.post("/api/v2/workspaces").send({ name: "Mine" }),
    ]);

    for (const res of attempts) expect([res.status, res.body.code]).toEqual([403, "DEMO_ACCOUNT_LOCKED"]);
    expect(await prisma.user.findUniqueOrThrow({ where: { email: "demo@devflow.local" } })).toMatchObject({
      name: "John Rey",
    });
    expect(await prisma.accessToken.count()).toBe(2);
  });

  it("can still read their profile, which says it is a demo account, and their tokens", async () => {
    expect((await admin.get("/api/v2/me")).body).toMatchObject({ email: "demo@devflow.local", isDemo: true });
    expect((await admin.get("/api/v2/me/tokens")).body.items).toHaveLength(2);
  });

  it("never get a password reset link, whatever the address", async () => {
    for (const address of ["demo@devflow.local", "aiko@acme.dev"]) {
      const res = await request(app)
        .post("/api/v2/auth/password/forgot")
        .set("Origin", FRONTEND_ORIGIN)
        .send({ email: address });
      expect(res.status).toBe(202);
    }

    expect(email.sent).toEqual([]);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("are flagged by the seed, and nobody else is", async () => {
    const flagged = await prisma.user.findMany({ where: { isDemo: true }, select: { email: true } });

    expect(flagged).toHaveLength(5);
    expect(await prisma.workspace.count({ where: { isDemo: true } })).toBe(1);
  });
});
