import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
afterAll(close);

let member: ReturnType<typeof asBrowser>;
let viewer: ReturnType<typeof asBrowser>;
let ids: { project: string; done: string; active: string; completed: string };

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env), undefined, { tracker: false });
  member = asBrowser(app, await signIn(app, "member@devflow.local"));
  viewer = asBrowser(app, await signIn(app, "viewer@devflow.local"));

  const project = await member.post("/api/v1/projects").send({ name: "DevFlow Core", key: "DEV" });
  const completed = await prisma.sprint.create({
    data: {
      projectId: project.body.id,
      number: 1,
      name: "Sprint 1",
      status: "completed",
      reportCommittedPoints: 10,
      reportCompletedPoints: 8,
      reportCompletedIssues: 3,
      reportCarriedOverIssues: 1,
      completedAt: new Date(),
    },
  });
  const active = await prisma.sprint.create({
    data: { projectId: project.body.id, number: 2, name: "Sprint 2", status: "active", endAt: new Date() },
  });
  ids = { project: project.body.id, done: project.body.workflow[3].id, active: active.id, completed: completed.id };

  const create = (body: object) => member.post("/api/v1/projects/DEV/issues").send(body);
  await create({ title: "Backlog A", estimate: 2 });
  await create({ title: "Backlog B" });
  await create({ title: "Sprint done", sprintId: active.id, estimate: 5, statusId: ids.done });
  await create({ title: "Sprint open", sprintId: active.id, estimate: 3 });
  // Issues of a completed sprint stay with it and are not part of the snapshot.
  await create({ title: "Old sprint work" });
  await prisma.issue.update({
    where: { projectId_number: { projectId: ids.project, number: 5 } },
    data: { sprintId: completed.id },
  });
});

describe("GET /api/v1/projects (summaries)", () => {
  it("adds active-sprint progress, backlog count and lead", async () => {
    const res = await viewer.get("/api/v1/projects");

    expect(res.body.items[0]).toMatchObject({
      key: "DEV",
      activeSprint: { name: "Sprint 2", donePoints: 5, totalPoints: 8, doneIssues: 1, totalIssues: 2 },
      backlogCount: 2,
      lead: { name: "Dmitri Kovac", initials: "DK" },
    });
  });
});

describe("GET /api/v1/projects/:key/snapshot", () => {
  it("returns the project, every sprint and the open issues in rank order", async () => {
    const res = await viewer.get("/api/v1/projects/dev/snapshot");

    expect(res.status).toBe(200);
    expect(res.body.project.key).toBe("DEV");
    expect(res.body.sprints.map((s: { number: number; status: string }) => [s.number, s.status])).toEqual([
      [1, "completed"],
      [2, "active"],
    ]);
    expect(res.body.sprints[0].report).toEqual({
      committedPoints: 10,
      completedPoints: 8,
      completedIssues: 3,
      carriedOverIssues: 1,
    });
    expect(res.body.sprints[1].report).toBeNull();
    expect(res.body.issues.map((i: { title: string }) => i.title)).toEqual([
      "Sprint open",
      "Sprint done",
      "Backlog B",
      "Backlog A",
    ]);
  });
});

describe("GET /api/v1/bootstrap", () => {
  it("returns me, the workspace with my role, the feature flags and every project", async () => {
    const res = await viewer.get("/api/v1/bootstrap");

    expect(res.status).toBe(200);
    expect(res.body.me).toMatchObject({ email: "viewer@devflow.local", role: "viewer" });
    expect(res.body.workspace).toMatchObject({ name: "Acme Inc", role: "viewer" });
    expect(Object.keys(res.body.config).sort()).toEqual(["email", "githubIntegration", "oauth"]);
    expect(res.body.projects.map((p: { key: string; backlogCount: number }) => [p.key, p.backlogCount])).toEqual([
      ["DEV", 2],
    ]);
  });
});
