import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_ISSUES } from "../src/demo/tracker-data.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser } from "./helpers/session.js";

const { app, prisma, close } = createTestApp();
afterAll(close);

type Browser = ReturnType<typeof asBrowser>;

async function signUp(name: string, email: string): Promise<{ browser: Browser; id: string; slug: string }> {
  const res = await request(app)
    .post("/api/v2/auth/signup")
    .set("Origin", FRONTEND_ORIGIN)
    .send({ name, email, password: "correct horse battery" });
  return { browser: asBrowser(app, sessionCookieHeader(res)), id: res.body.user.id, slug: res.body.workspaces[0].slug };
}

let ada: Awaited<ReturnType<typeof signUp>>;
beforeEach(async () => {
  await truncateAll(prisma);
  ada = await signUp("Ada Lovelace", "ada@acme.dev");
});

/** Adds an existing account to a workspace directly (invites for existing accounts come later). */
async function addMember(slug: string, userId: string, role: "admin" | "member" | "viewer") {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug } });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId, role } });
}

describe("POST /api/v2/workspaces", () => {
  it("creates a workspace with you as admin and a copy of the sample projects", async () => {
    const res = await ada.browser.post("/api/v2/workspaces").send({ name: "Globex" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), slug: "globex", name: "Globex", role: "admin", isDemo: false });
    const projects = await ada.browser.get("/api/v2/workspaces/globex/projects");
    expect(projects.body.items.map((p: { key: string; leadId: string }) => [p.key, p.leadId])).toEqual([
      ["DEV", ada.id],
      ["BIL", ada.id],
      ["MOB", ada.id],
    ]);
  });

  it("gives you the demo admin's issues, leaves the rest unassigned and copies no comments", async () => {
    await ada.browser.post("/api/v2/workspaces").send({ name: "Globex" });
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "globex" } });

    const issues = await prisma.issue.findMany({ where: { project: { workspaceId: workspace.id } } });
    expect(issues).toHaveLength(DEMO_ISSUES.length);
    const johns = DEMO_ISSUES.filter((i) => i.assignee === "u-jr").length;
    expect(issues.filter((i) => i.assigneeId === ada.id)).toHaveLength(johns);
    expect(issues.filter((i) => i.assigneeId !== null && i.assigneeId !== ada.id)).toEqual([]);
    expect(issues.every((i) => i.commentCount === 0)).toBe(true);
    expect(await prisma.issueComment.count({ where: { issue: { project: { workspaceId: workspace.id } } } })).toBe(0);
    expect(await prisma.project.count({ where: { workspaceId: workspace.id, isSample: false } })).toBe(0);
  });

  it("starts empty without sample data", async () => {
    await ada.browser.post("/api/v2/workspaces").send({ name: "Globex", sampleData: false });

    expect((await ada.browser.get("/api/v2/workspaces/globex/projects")).body.items).toEqual([]);
  });

  it("suffixes the slug when the name is taken, and validates the name", async () => {
    await ada.browser.post("/api/v2/workspaces").send({ name: "Globex", sampleData: false });

    const twin = await ada.browser.post("/api/v2/workspaces").send({ name: "Globex", sampleData: false });
    const blank = await ada.browser.post("/api/v2/workspaces").send({ name: "  " });

    expect(twin.body.slug).toMatch(/^globex-[a-z0-9]{4}$/);
    expect(blank.status).toBe(422);
    expect(blank.body.errors[0].field).toBe("name");
  });

  it("is for signed-in sessions, not access tokens", async () => {
    const { secret } = (
      await ada.browser
        .post("/api/v2/me/tokens")
        .send({ name: "cli", scopes: ["projects:admin"], expiresInDays: null, workspace: ada.slug })
    ).body;

    const res = await request(app)
      .post("/api/v2/workspaces")
      .set("Authorization", `Bearer ${secret as string}`)
      .send({ name: "Globex" });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/v2/workspaces", () => {
  it("lists your workspaces with your role in each, oldest first, one page at a time", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(grace.slug, ada.id, "viewer");
    await ada.browser.post("/api/v2/workspaces").send({ name: "Globex", sampleData: false });

    const first = await ada.browser.get("/api/v2/workspaces?limit=2");
    const second = await ada.browser.get(`/api/v2/workspaces?limit=2&cursor=${first.body.nextCursor as string}`);

    expect(first.body.items.map((w: { slug: string; role: string }) => [w.slug, w.role])).toEqual([
      [ada.slug, "admin"],
      [grace.slug, "viewer"],
    ]);
    expect(second.body).toEqual({
      items: [expect.objectContaining({ slug: "globex", role: "admin" })],
      nextCursor: null,
    });
    expect((await ada.browser.get("/api/v2/auth/me")).body.workspaces).toHaveLength(3);
  });
});

describe("roles per workspace", () => {
  it("lets one person act as admin in one workspace and as viewer in another", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(grace.slug, ada.id, "viewer");
    const create = (slug: string) =>
      ada.browser.post(`/api/v2/workspaces/${slug}/projects`).send({ name: "Engines", key: "ENG" });

    expect((await create(ada.slug)).status).toBe(201);
    expect((await create(grace.slug)).status).toBe(403);
    expect((await ada.browser.get(`/api/v2/workspaces/${grace.slug}/projects`)).status).toBe(200);
    expect((await ada.browser.get(`/api/v2/workspaces/${grace.slug}/bootstrap`)).body.workspace.role).toBe("viewer");
  });

  it("applies a role change in one workspace only", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(grace.slug, ada.id, "viewer");

    await grace.browser.patch(`/api/v2/workspaces/${grace.slug}/members/${ada.id}`).send({ role: "member" });

    const roles = (await ada.browser.get("/api/v2/auth/me")).body.workspaces.map(
      (w: { slug: string; role: string }) => [w.slug, w.role],
    );
    expect(roles).toEqual([
      [ada.slug, "admin"],
      [grace.slug, "member"],
    ]);
  });
});

describe("PATCH /api/v2/workspaces/:ws", () => {
  it("renames the workspace and keeps its slug", async () => {
    const res = await ada.browser.patch(`/api/v2/workspaces/${ada.slug}`).send({ name: "Analytical Engines" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ slug: ada.slug, name: "Analytical Engines" });
    expect((await ada.browser.get(`/api/v2/workspaces/${ada.slug}`)).body.name).toBe("Analytical Engines");
  });

  it("is admin-only", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(ada.slug, grace.id, "member");

    expect((await grace.browser.patch(`/api/v2/workspaces/${ada.slug}`).send({ name: "Mine now" })).status).toBe(403);
  });
});

describe("DELETE /api/v2/workspaces/:ws", () => {
  it("deletes the workspace and everything in it, but keeps the accounts", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(ada.slug, grace.id, "member");

    const res = await ada.browser.delete(`/api/v2/workspaces/${ada.slug}`);

    expect(res.status).toBe(204);
    expect((await ada.browser.get(`/api/v2/workspaces/${ada.slug}`)).status).toBe(404);
    expect((await grace.browser.get(`/api/v2/workspaces/${ada.slug}/projects`)).status).toBe(404);
    expect(await prisma.workspace.count({ where: { slug: ada.slug } })).toBe(0);
    expect(await prisma.user.count()).toBe(2);
    expect((await ada.browser.get("/api/v2/auth/me")).body.workspaces).toEqual([]);
  });

  it("is admin-only", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(ada.slug, grace.id, "member");

    expect((await grace.browser.delete(`/api/v2/workspaces/${ada.slug}`)).status).toBe(403);
  });
});

describe("POST /api/v2/workspaces/:ws/demo/reset", () => {
  it("restores the sample projects and keeps the projects you created", async () => {
    const base = `/api/v2/workspaces/${ada.slug}`;
    await ada.browser.delete(`${base}/projects/MOB`);
    await ada.browser.patch(`${base}/issues/DEV-104`).send({ title: "Edited" });
    await ada.browser.post(`${base}/projects`).send({ name: "Mine", key: "MINE" });

    const res = await ada.browser.post(`${base}/demo/reset`);

    expect(res.status).toBe(204);
    const projects = await ada.browser.get(`${base}/projects`);
    expect(projects.body.items.map((p: { key: string }) => p.key).sort()).toEqual(["BIL", "DEV", "MINE", "MOB"]);
    expect((await ada.browser.get(`${base}/issues/DEV-104`)).body.title).not.toBe("Edited");
    expect(await prisma.issue.count({ where: { assigneeId: { not: null, notIn: [ada.id] } } })).toBe(0);
  });

  it("skips a sample whose key a project of yours now uses", async () => {
    const base = `/api/v2/workspaces/${ada.slug}`;
    await ada.browser.delete(`${base}/projects/MOB`);
    await ada.browser.post(`${base}/projects`).send({ name: "My mobile app", key: "MOB" });

    await ada.browser.post(`${base}/demo/reset`);

    const mob = await ada.browser.get(`${base}/projects/MOB`);
    expect(mob.body.name).toBe("My mobile app");
  });

  it("is admin-only", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(ada.slug, grace.id, "member");

    expect((await grace.browser.post(`/api/v2/workspaces/${ada.slug}/demo/reset`)).status).toBe(403);
  });
});

describe("POST /api/v2/workspaces/:ws/leave", () => {
  it("ends the membership, deletes your tokens for it and unassigns your work there", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(ada.slug, grace.id, "member");
    await grace.browser.post(`/api/v2/workspaces/${ada.slug}/projects/DEV/issues`).send({
      title: "Grace's issue",
      assigneeId: grace.id,
    });
    await grace.browser
      .post("/api/v2/me/tokens")
      .send({ name: "cli", scopes: ["issues:read"], expiresInDays: null, workspace: ada.slug });
    await grace.browser
      .post("/api/v2/me/tokens")
      .send({ name: "own", scopes: ["issues:read"], expiresInDays: null, workspace: grace.slug });

    const res = await grace.browser.post(`/api/v2/workspaces/${ada.slug}/leave`);

    expect(res.status).toBe(204);
    expect((await grace.browser.get(`/api/v2/workspaces/${ada.slug}`)).status).toBe(404);
    expect((await prisma.accessToken.findMany({ where: { userId: grace.id } })).map((t) => t.name)).toEqual(["own"]);
    expect(await prisma.issue.findFirstOrThrow({ where: { title: "Grace's issue" } })).toMatchObject({
      assigneeId: null,
    });
  });

  it("keeps the last admin from leaving while others remain", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(ada.slug, grace.id, "member");

    const res = await ada.browser.post(`/api/v2/workspaces/${ada.slug}/leave`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LAST_ADMIN");
  });

  it("tells the only member to delete the workspace instead", async () => {
    const res = await ada.browser.post(`/api/v2/workspaces/${ada.slug}/leave`);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "LAST_ADMIN", detail: expect.stringContaining("Delete the workspace") });
  });

  it("lets an admin leave once another admin remains", async () => {
    const grace = await signUp("Grace Hopper", "grace@acme.dev");
    await addMember(ada.slug, grace.id, "admin");

    expect((await ada.browser.post(`/api/v2/workspaces/${ada.slug}/leave`)).status).toBe(204);
  });
});
