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

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env), undefined, { tracker: false });
  member = asBrowser(app, await signIn(app, "member@devflow.local"));
  viewer = asBrowser(app, await signIn(app, "viewer@devflow.local"));
  await member.post("/api/v1/projects").send({ name: "DevFlow Core", key: "DEV" });
});

const newSprint = () => member.post("/api/v1/projects/DEV/sprints");
const issueIn = (sprintId: string | null, body: object = {}) =>
  member.post("/api/v1/projects/DEV/issues").send({ title: "Work", sprintId, ...body });

describe("POST /api/v1/projects/:key/sprints", () => {
  it("creates Sprint 1, then Sprint 2, in the planned state", async () => {
    const first = await newSprint();
    const second = await newSprint();

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      number: 1,
      name: "Sprint 1",
      goal: "",
      status: "planned",
      startAt: null,
      endAt: null,
      committedPoints: null,
      completedAt: null,
      report: null,
    });
    expect(second.body).toMatchObject({ number: 2, name: "Sprint 2" });
  });

  it("numbers concurrent creates without gaps or duplicates", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => newSprint()));

    expect(results.map((r) => r.body.number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("is for members and admins only", async () => {
    expect((await viewer.post("/api/v1/projects/DEV/sprints")).status).toBe(403);
  });
});

describe("GET /api/v1/projects/:key/sprints", () => {
  it("lists by number, filtered by status and paged", async () => {
    for (let i = 0; i < 3; i++) await newSprint();
    await prisma.sprint.updateMany({ where: { number: 2 }, data: { status: "completed" } });

    const planned = await viewer.get("/api/v1/projects/DEV/sprints?status=planned,active");
    const page1 = await viewer.get("/api/v1/projects/DEV/sprints?limit=2");
    const page2 = await viewer.get(`/api/v1/projects/DEV/sprints?limit=2&cursor=${page1.body.nextCursor}`);

    expect(planned.body.items.map((s: { number: number }) => s.number)).toEqual([1, 3]);
    expect([...page1.body.items, ...page2.body.items].map((s: { number: number }) => s.number)).toEqual([1, 2, 3]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it("rejects an unknown status filter", async () => {
    const res = await viewer.get("/api/v1/projects/DEV/sprints?status=planned,archived");

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe("status");
  });
});

describe("PATCH /api/v1/sprints/:id", () => {
  it("renames a sprint and sets its goal", async () => {
    const { id } = (await newSprint()).body;

    const res = await member.patch(`/api/v1/sprints/${id}`).send({ name: "Polish", goal: "Ship SSO." });

    expect(res.body).toMatchObject({ name: "Polish", goal: "Ship SSO." });
  });

  it("is 404 for a sprint of another workspace or a malformed id", async () => {
    expect(
      (await member.patch("/api/v1/sprints/0193f1c2-0000-7000-8000-000000000999").send({ goal: "x" })).status,
    ).toBe(404);
    expect((await member.patch("/api/v1/sprints/nope").send({ goal: "x" })).status).toBe(404);
  });
});

describe("DELETE /api/v1/sprints/:id", () => {
  it("deletes a planned sprint and returns its issues to the backlog", async () => {
    const { id } = (await newSprint()).body;
    await issueIn(id, { estimate: 3 });

    const res = await member.delete(`/api/v1/sprints/${id}`);

    expect(res.status).toBe(204);
    expect((await viewer.get("/api/v1/issues/DEV-1")).body.sprintId).toBeNull();
    const last = await prisma.issueEvent.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(last).toMatchObject({ kind: "sprint", sprintId: null });
  });

  it("refuses to delete a sprint that is not planned", async () => {
    const { id } = (await newSprint()).body;
    await prisma.sprint.update({ where: { id }, data: { status: "active" } });

    const res = await member.delete(`/api/v1/sprints/${id}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPRINT_NOT_PLANNED");
  });
});
