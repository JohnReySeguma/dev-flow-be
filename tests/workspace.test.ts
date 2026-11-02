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
  await seed(prisma, createLogger(env));
});

describe("GET /api/v1/workspace", () => {
  it.each([
    ["demo@devflow.local", "admin"],
    ["member@devflow.local", "member"],
    ["viewer@devflow.local", "viewer"],
  ])("tells %s their role (%s)", async (email, role) => {
    const res = await asBrowser(app, await signIn(app, email)).get("/api/v1/workspace");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Acme Inc", role });
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/workspace")).status).toBe(401);
  });
});

describe("GET /api/v1/workspace/members", () => {
  it("lists the team in the frontend's TeamMember shape, oldest first", async () => {
    const res = await asBrowser(app, await signIn(app, "viewer@devflow.local")).get("/api/v1/workspace/members");

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

    const res = await asBrowser(app, await signIn(app, "demo@devflow.local")).get("/api/v1/workspace/members");

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
      const res = await browser.get(`/api/v1/workspace/members?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((m: { email: string }) => m.email));
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(DEMO_MEMBERS.length + 1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.at(-1)).toBe("grace@acme.dev");
  });
});
