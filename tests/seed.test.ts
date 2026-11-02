import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MEMBERS, DEMO_PASSWORD, DEMO_WORKSPACE_NAME, seed } from "../prisma/seed.js";
import { DEMO_ISSUES } from "../src/demo/tracker-data.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN } from "./helpers/cookies.js";
import { nonEmptyTables, truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
const logger = createLogger(env);

beforeEach(() => truncateAll(prisma));
afterAll(close);

describe("seed", () => {
  it("creates the demo workspace and the frontend's team", async () => {
    expect(await seed(prisma, logger)).toBe(true);

    expect(await prisma.workspace.findMany({ select: { name: true } })).toEqual([{ name: DEMO_WORKSPACE_NAME }]);
    const users = await prisma.user.findMany({ select: { email: true, role: true }, orderBy: { email: "asc" } });
    expect(users).toHaveLength(DEMO_MEMBERS.length);
    expect(users).toEqual(
      expect.arrayContaining([
        { email: "demo@devflow.local", role: "admin" },
        { email: "member@devflow.local", role: "member" },
        { email: "viewer@devflow.local", role: "viewer" },
      ]),
    );
  });

  it.each([
    ["demo@devflow.local", "admin", "John Rey"],
    ["member@devflow.local", "member", "Dmitri Kovac"],
    ["viewer@devflow.local", "viewer", "Lucas Brandt"],
  ])("lets %s sign in as %s", async (email, role, name) => {
    await seed(prisma, logger);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ email, password: DEMO_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role, name });
    expect(res.body.workspace.name).toBe(DEMO_WORKSPACE_NAME);
  });

  it("gives the admin the frontend's example access tokens", async () => {
    await seed(prisma, logger);

    const tokens = await prisma.accessToken.findMany({ select: { lastFour: true } });
    expect(tokens.map((t) => t.lastFour).sort()).toEqual(["Zx02", "q7Rk"].sort());
  });

  it("leaves a database that already has data untouched", async () => {
    await seed(prisma, logger);

    expect(await seed(prisma, logger)).toBe(false);
    expect(await prisma.user.count()).toBe(DEMO_MEMBERS.length);
  });
});

/** The frontend fixtures pad some numbers (DEV-088); the API renders keys from the number, unpadded. */
const apiKey = (key: string) => key.replace(/-0+(\d)/, "-$1");

describe("demo tracker", () => {
  beforeEach(async () => {
    await seed(prisma, logger);
  });
  const snapshot = async (key: string) =>
    (
      await request(app)
        .get(`/api/v1/projects/${key}/snapshot`)
        .set("Cookie", await signIn(app, "demo@devflow.local"))
    ).body;

  it("recreates the frontend's projects, keys and rank order", async () => {
    const dev = await snapshot("DEV");

    expect(dev.project).toMatchObject({ key: "DEV", name: "DevFlow Core", nextIssueNumber: 134 });
    expect(dev.issues.map((i: { id: string }) => i.id)).toEqual(
      DEMO_ISSUES.filter((i) => i.key.startsWith("DEV-")).map((i) => apiKey(i.key)),
    );
    expect((await snapshot("BIL")).project.workflow.map((s: { name: string }) => s.name)).toEqual([
      "Triage",
      "To Do",
      "In Progress",
      "Code Review",
      "QA",
      "Released",
    ]);
    expect((await snapshot("MOB")).issues).toHaveLength(5);
  });

  it("keeps every issue's fields, including git links and due dates", async () => {
    const dev104 = (await snapshot("DEV")).issues.find((i: { id: string }) => i.id === "DEV-104");

    expect(dev104).toMatchObject({
      type: "bug",
      priority: "urgent",
      title: "OAuth refresh token rotation fails on concurrent tabs",
      tags: ["auth", "frontend"],
      git: { kind: "pr", number: 421, state: "open" },
      estimate: 5,
      comments: 12,
      dueAt: expect.any(String),
      resolvedAt: null,
    });
    expect(await prisma.issueComment.count({ where: { issue: { number: 104 } } })).toBe(12);
  });

  it("derives sprint state as the frontend does", async () => {
    const dev = await snapshot("DEV");
    const sprint25 = dev.sprints.find((s: { number: number }) => s.number === 25);
    const sprint24 = dev.sprints.find((s: { number: number }) => s.number === 24);

    expect(dev.sprints.map((s: { number: number }) => s.number)).toEqual([21, 22, 23, 24, 25, 26]);
    expect(sprint25).toMatchObject({ status: "active", committedPoints: 45, report: null });
    expect(sprint24.report).toEqual({
      committedPoints: 40,
      completedPoints: 33,
      completedIssues: 12,
      carriedOverIssues: 3,
    });
    const done = dev.issues.filter((i: { resolvedAt: string | null }) => i.resolvedAt !== null);
    expect(done.map((i: { id: string }) => i.id)).toEqual(["DEV-88", "DEV-92", "DEV-94"]);
  });

  it("records history for burndown", async () => {
    const resolved = await prisma.issueEvent.count({ where: { done: true } });

    expect(resolved).toBe(DEMO_ISSUES.filter((i) => i.resolved !== undefined).length);
  });
});

describe("test isolation", () => {
  it("clears every table between tests", async () => {
    await seed(prisma, logger);

    await truncateAll(prisma);

    expect(await nonEmptyTables(prisma)).toEqual([]);
  });
});

describe("POST /api/v1/workspace/demo/reset", () => {
  beforeEach(async () => {
    await seed(prisma, logger);
  });

  it("restores the demo projects without touching accounts", async () => {
    const admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
    await admin.delete("/api/v1/projects/MOB");
    await admin.post("/api/v1/projects").send({ name: "Scratch", key: "TMP" });
    await admin.patch("/api/v1/issues/DEV-104").send({ title: "Edited during the demo" });
    const users = await prisma.user.count();

    const res = await admin.post("/api/v1/workspace/demo/reset");

    expect(res.status).toBe(204);
    const projects = await admin.get("/api/v1/projects");
    expect(projects.body.items.map((p: { key: string }) => p.key)).toEqual(["DEV", "BIL", "MOB"]);
    expect((await admin.get("/api/v1/issues/DEV-104")).body.title).toBe(
      "OAuth refresh token rotation fails on concurrent tabs",
    );
    expect(await prisma.user.count()).toBe(users);
  });

  it("is admin-only", async () => {
    const member = asBrowser(app, await signIn(app, "member@devflow.local"));

    expect((await member.post("/api/v1/workspace/demo/reset")).status).toBe(403);
  });

  it("is not available without SEED_DEMO_DATA", async () => {
    const production = createTestApp({ env: { SEED_DEMO_DATA: false } });
    const admin = asBrowser(production.app, await signIn(production.app, "demo@devflow.local"));

    const res = await admin.post("/api/v1/workspace/demo/reset");

    expect(res.status).toBe(404);
    await production.close();
  });
});
