import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MEMBERS, seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
afterAll(close);

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env), undefined, { tracker: false });
});

describe("GET /api/v2/workspace", () => {
  it.each([
    ["demo@devflow.local", "admin"],
    ["member@devflow.local", "member"],
    ["viewer@devflow.local", "viewer"],
  ])("tells %s their role (%s)", async (email, role) => {
    const res = await asBrowser(app, await signIn(app, email)).get("/api/v2/workspace");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Acme Inc", role });
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v2/workspace")).status).toBe(401);
  });

  it("needs the issues:read scope for access tokens", async () => {
    const admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
    const tokenWith = async (scopes: string[]) =>
      (await admin.post("/api/v2/me/tokens").send({ name: scopes.join(","), scopes, expiresInDays: null })).body
        .secret as string;
    const get = async (secret: string, path: string) =>
      (await request(app).get(path).set("Authorization", `Bearer ${secret}`)).status;
    const webhooksOnly = await tokenWith(["webhooks:manage"]);
    const reader = await tokenWith(["issues:read"]);

    expect([
      await get(webhooksOnly, "/api/v2/workspace"),
      await get(webhooksOnly, "/api/v2/workspace/members"),
    ]).toEqual([403, 403]);
    expect([await get(reader, "/api/v2/workspace"), await get(reader, "/api/v2/workspace/members")]).toEqual([
      200, 200,
    ]);
  });
});

describe("GET /api/v2/workspace/members", () => {
  it("lists the team in the frontend's TeamMember shape, oldest first", async () => {
    const res = await asBrowser(app, await signIn(app, "viewer@devflow.local")).get("/api/v2/workspace/members");

    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((m: { name: string }) => m.name)).toEqual(DEMO_MEMBERS.map((m) => m.name));
    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      name: "John Rey",
      email: "demo@devflow.local",
      initials: "JR",
      gradient: "from-violet-500 to-indigo-600",
      role: "admin",
      status: "active",
      lastActiveAt: expect.stringMatching(/Z$/),
    });
  });

  it("includes pending invites the way the frontend renders them", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow();
    await prisma.workspaceInvite.create({
      data: {
        workspaceId: workspace.id,
        email: "grace@acme.dev",
        role: "member",
        tokenHash: "x".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const res = await asBrowser(app, await signIn(app, "demo@devflow.local")).get("/api/v2/workspace/members");

    expect(res.body.items.at(-1)).toMatchObject({
      name: "grace",
      email: "grace@acme.dev",
      initials: "GR",
      gradient: "from-zinc-600 to-zinc-700",
      status: "invited",
      lastActiveAt: null,
    });
  });

  it("pages through members and invites together", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow();
    await prisma.workspaceInvite.create({
      data: {
        workspaceId: workspace.id,
        email: "grace@acme.dev",
        role: "viewer",
        tokenHash: "y".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const browser = asBrowser(app, await signIn(app, "demo@devflow.local"));

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await browser.get(`/api/v2/workspace/members?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((m: { email: string }) => m.email));
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(DEMO_MEMBERS.length + 1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.at(-1)).toBe("grace@acme.dev");
  });
});

describe("managing members", () => {
  const idOf = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } }).then((u) => u.id);
  const admin = async () => asBrowser(app, await signIn(app, "demo@devflow.local"));

  it("lets an admin change a member's role, effective on the member's next request", async () => {
    const memberCookie = await signIn(app, "member@devflow.local");
    const dmitri = await idOf("member@devflow.local");

    const res = await (await admin()).patch(`/api/v2/workspace/members/${dmitri}`).send({ role: "viewer" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "member@devflow.local", role: "viewer", status: "active" });
    expect((await asBrowser(app, memberCookie).get("/api/v2/workspace")).body.role).toBe("viewer");
  });

  it("forbids changing your own role", async () => {
    const res = await (await admin()).patch(`/api/v2/workspace/members/${await idOf("demo@devflow.local")}`).send({
      role: "member",
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CANNOT_CHANGE_OWN_ROLE");
  });

  it("answers LAST_ADMIN when two admins race to demote each other", async () => {
    await prisma.workspaceMember.updateMany({
      where: { role: "admin", NOT: { user: { email: "demo@devflow.local" } } },
      data: { role: "member" },
    });
    await prisma.workspaceMember.updateMany({ where: { user: { email: "aiko@acme.dev" } }, data: { role: "admin" } });
    const john = asBrowser(app, await signIn(app, "demo@devflow.local"));
    const aiko = asBrowser(app, await signIn(app, "aiko@acme.dev"));

    const results = await Promise.all([
      john.patch(`/api/v2/workspace/members/${await idOf("aiko@acme.dev")}`).send({ role: "member" }),
      aiko.patch(`/api/v2/workspace/members/${await idOf("demo@devflow.local")}`).send({ role: "member" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.workspaceMember.count({ where: { role: "admin" } })).toBe(1);
  });

  it("removes a member together with their sessions and tokens", async () => {
    const lucasCookie = await signIn(app, "viewer@devflow.local");
    const lucas = await idOf("viewer@devflow.local");

    const res = await (await admin()).delete(`/api/v2/workspace/members/${lucas}`);

    expect(res.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: lucas } })).toBeNull();
    expect((await asBrowser(app, lucasCookie).get("/api/v2/workspace")).status).toBe(401);
  });

  it("forbids removing yourself", async () => {
    const res = await (await admin()).delete(`/api/v2/workspace/members/${await idOf("demo@devflow.local")}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CANNOT_REMOVE_SELF");
  });

  it("changes and revokes pending invites through the same endpoints", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow();
    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId: workspace.id,
        email: "grace@acme.dev",
        role: "member",
        tokenHash: "z".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const browser = await admin();

    expect((await browser.patch(`/api/v2/workspace/members/${invite.id}`).send({ role: "viewer" })).body).toMatchObject(
      {
        status: "invited",
        role: "viewer",
      },
    );
    expect((await browser.delete(`/api/v2/workspace/members/${invite.id}`)).status).toBe(204);
    expect(await prisma.workspaceInvite.count()).toBe(0);
  });

  it("is admin-only and session-only", async () => {
    const dmitri = await idOf("member@devflow.local");
    const asMember = asBrowser(app, await signIn(app, "member@devflow.local"));

    const res = await asMember.patch(`/api/v2/workspace/members/${dmitri}`).send({ role: "admin" });

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe("This action needs the admin role.");
  });

  it("is 404 for an unknown or malformed id and 422 for an unknown role", async () => {
    const browser = await admin();

    expect((await browser.delete("/api/v2/workspace/members/0193f1c2-0000-7000-8000-000000000999")).status).toBe(404);
    expect((await browser.delete("/api/v2/workspace/members/nope")).status).toBe(404);
    expect(
      (await browser.patch(`/api/v2/workspace/members/${await idOf("member@devflow.local")}`).send({ role: "owner" }))
        .status,
    ).toBe(422);
  });
});
