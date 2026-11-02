import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
afterAll(close);

let viewer: ReturnType<typeof asBrowser>;
const sprintId = async (key: string, number: number) =>
  (await prisma.sprint.findFirstOrThrow({ where: { number, project: { key } } })).id;

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env));
  viewer = asBrowser(app, await signIn(app, "viewer@devflow.local"));
});

describe("GET /api/v1/sprints/:id/burndown", () => {
  it("burns down the demo's active sprint from its issue history", async () => {
    const res = await viewer.get(`/api/v1/sprints/${await sprintId("DEV", 25)}/burndown`);

    expect(res.status).toBe(200);
    expect(res.body.committedPoints).toBe(45);
    // A 14-day sprint that started 6 days ago: 15 points, the last 8 still ahead.
    expect(res.body.days).toHaveLength(15);
    expect(res.body.days.map((d: { remaining: number | null }) => d.remaining)).toEqual([
      45,
      45,
      42,
      42,
      37,
      36,
      36,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(res.body.days[0].ideal).toBe(45);
    expect(res.body.days.at(-1).ideal).toBe(0);
  });

  it("has no days for a sprint that has not started", async () => {
    const res = await viewer.get(`/api/v1/sprints/${await sprintId("DEV", 26)}/burndown`);

    expect(res.body).toMatchObject({ committedPoints: null, days: [] });
  });

  it("reads a completed sprint as it stood just before completion", async () => {
    const member = asBrowser(app, await signIn(app, "member@devflow.local"));
    const id = await sprintId("BIL", 8);

    await member.post(`/api/v1/sprints/${id}/complete`).send({ carryOver: { kind: "backlog" } });
    const res = await viewer.get(`/api/v1/sprints/${id}/burndown`);

    const remaining = res.body.days.map((d: { remaining: number | null }) => d.remaining);
    expect(remaining.every((r: number | null) => r !== null)).toBe(true);
    expect(remaining.at(-1)).toBe(21);
  });
});

describe("GET /api/v1/projects/:key/reports/velocity", () => {
  it("returns committed against completed points, oldest first", async () => {
    const res = await viewer.get("/api/v1/projects/DEV/reports/velocity");

    expect(
      res.body.map((s: { name: string; committed: number; completed: number }) => [s.name, s.committed, s.completed]),
    ).toEqual([
      ["Sprint 21", 34, 29],
      ["Sprint 22", 38, 36],
      ["Sprint 23", 31, 31],
      ["Sprint 24", 40, 33],
    ]);
  });

  it("limits to the most recent sprints", async () => {
    const res = await viewer.get("/api/v1/projects/DEV/reports/velocity?limit=2");

    expect(res.body.map((s: { name: string }) => s.name)).toEqual(["Sprint 23", "Sprint 24"]);
  });
});

describe("GET /api/v1/projects/:key/reports/history", () => {
  it("lists completed sprints newest first, with their reports, page by page", async () => {
    const page1 = await viewer.get("/api/v1/projects/DEV/reports/history?limit=3");
    const page2 = await viewer.get(`/api/v1/projects/DEV/reports/history?limit=3&cursor=${page1.body.nextCursor}`);

    const all = [...page1.body.items, ...page2.body.items];
    expect(all.map((s: { number: number }) => s.number)).toEqual([24, 23, 22, 21]);
    expect(all[0]).toMatchObject({
      goal: "Realtime presence and Live Sync",
      status: "completed",
      report: { committedPoints: 40, completedPoints: 33, completedIssues: 12, carriedOverIssues: 3 },
    });
    expect(page2.body.nextCursor).toBeNull();
  });
});
