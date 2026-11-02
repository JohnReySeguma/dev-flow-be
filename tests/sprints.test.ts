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
  await member.post("/api/v2/projects").send({ name: "DevFlow Core", key: "DEV" });
});

const newSprint = () => member.post("/api/v2/projects/DEV/sprints");
const issueIn = (sprintId: string | null, body: object = {}) =>
  member.post("/api/v2/projects/DEV/issues").send({ title: "Work", sprintId, ...body });

describe("POST /api/v2/projects/:key/sprints", () => {
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
    expect((await viewer.post("/api/v2/projects/DEV/sprints")).status).toBe(403);
  });
});

describe("GET /api/v2/projects/:key/sprints", () => {
  it("lists by number, filtered by status and paged", async () => {
    for (let i = 0; i < 3; i++) await newSprint();
    await prisma.sprint.updateMany({ where: { number: 2 }, data: { status: "completed" } });

    const planned = await viewer.get("/api/v2/projects/DEV/sprints?status=planned,active");
    const page1 = await viewer.get("/api/v2/projects/DEV/sprints?limit=2");
    const page2 = await viewer.get(`/api/v2/projects/DEV/sprints?limit=2&cursor=${page1.body.nextCursor}`);

    expect(planned.body.items.map((s: { number: number }) => s.number)).toEqual([1, 3]);
    expect([...page1.body.items, ...page2.body.items].map((s: { number: number }) => s.number)).toEqual([1, 2, 3]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it("rejects an unknown status filter", async () => {
    const res = await viewer.get("/api/v2/projects/DEV/sprints?status=planned,archived");

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe("status");
  });
});

describe("PATCH /api/v2/sprints/:id", () => {
  it("renames a sprint and sets its goal", async () => {
    const { id } = (await newSprint()).body;

    const res = await member.patch(`/api/v2/sprints/${id}`).send({ name: "Polish", goal: "Ship SSO." });

    expect(res.body).toMatchObject({ name: "Polish", goal: "Ship SSO." });
  });

  it("is 404 for a sprint of another workspace or a malformed id", async () => {
    expect(
      (await member.patch("/api/v2/sprints/0193f1c2-0000-7000-8000-000000000999").send({ goal: "x" })).status,
    ).toBe(404);
    expect((await member.patch("/api/v2/sprints/nope").send({ goal: "x" })).status).toBe(404);
  });
});

describe("DELETE /api/v2/sprints/:id", () => {
  it("deletes a planned sprint and returns its issues to the backlog", async () => {
    const { id } = (await newSprint()).body;
    await issueIn(id, { estimate: 3 });

    const res = await member.delete(`/api/v2/sprints/${id}`);

    expect(res.status).toBe(204);
    expect((await viewer.get("/api/v2/issues/DEV-1")).body.sprintId).toBeNull();
    const last = await prisma.issueEvent.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(last).toMatchObject({ kind: "sprint", sprintId: null });
  });

  it("refuses to delete a sprint that is not planned", async () => {
    const { id } = (await newSprint()).body;
    await prisma.sprint.update({ where: { id }, data: { status: "active" } });

    const res = await member.delete(`/api/v2/sprints/${id}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPRINT_NOT_PLANNED");
  });
});

describe("sprint lifecycle", () => {
  let done = "";
  beforeEach(async () => {
    done = (await viewer.get("/api/v2/projects/DEV")).body.workflow[3].id;
  });
  const start = (id: string, body: object = {}) =>
    member.post(`/api/v2/sprints/${id}/start`).send({ name: "Sprint 1", goal: "Ship it.", durationDays: 14, ...body });
  const complete = (id: string, carryOver: object) => member.post(`/api/v2/sprints/${id}/complete`).send({ carryOver });

  it("starts a planned sprint for the chosen duration and commits to its points", async () => {
    const { id } = (await newSprint()).body;
    await issueIn(id, { estimate: 5 });
    await issueIn(id, { estimate: 3 });
    await issueIn(id);

    const res = await start(id, { name: "Kick-off", goal: "Ship SSO." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Kick-off", goal: "Ship SSO.", status: "active", committedPoints: 8 });
    expect(Date.parse(res.body.endAt) - Date.parse(res.body.startAt)).toBe(14 * 86_400_000);
  });

  it("allows only one active sprint per project, even under concurrent starts", async () => {
    const a = (await newSprint()).body.id;
    const b = (await newSprint()).body.id;

    const results = await Promise.all([start(a), start(b)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe("SPRINT_ALREADY_ACTIVE");
    expect(await prisma.sprint.count({ where: { status: "active" } })).toBe(1);
  });

  it("refuses to start a sprint twice and validates the duration", async () => {
    const { id } = (await newSprint()).body;
    await start(id);

    expect((await start(id)).body.code).toBe("SPRINT_NOT_PLANNED");
    expect((await start((await newSprint()).body.id, { durationDays: 0 })).status).toBe(422);
  });

  it("completes with a report and carries unfinished work to the backlog", async () => {
    const { id } = (await newSprint()).body;
    await issueIn(id, { estimate: 5, statusId: done });
    await issueIn(id, { estimate: 3 });
    await start(id);
    await issueIn(id, { estimate: 2 }); // added mid-sprint: not part of the commitment

    const res = await complete(id, { kind: "backlog" });

    expect(res.status).toBe(200);
    expect(res.body.sprint).toMatchObject({
      status: "completed",
      completedAt: expect.any(String),
      report: { committedPoints: 8, completedPoints: 5, completedIssues: 1, carriedOverIssues: 2 },
    });
    expect(res.body.carriedOverTo).toBeNull();
    const backlog = await viewer.get("/api/v2/projects/DEV/issues?sprint=backlog");
    expect(backlog.body.items.map((i: { id: string }) => i.id).sort()).toEqual(["DEV-2", "DEV-3"]);
    expect((await viewer.get("/api/v2/issues/DEV-1")).body.sprintId).toBe(id);
  });

  it("carries unfinished work into a planned sprint or a new one", async () => {
    const first = (await newSprint()).body.id;
    const next = (await newSprint()).body.id;
    await issueIn(first);
    await start(first);

    const toPlanned = await complete(first, { kind: "sprint", sprintId: next });
    expect(toPlanned.body.carriedOverTo.id).toBe(next);
    expect((await viewer.get("/api/v2/issues/DEV-1")).body.sprintId).toBe(next);

    await start(next);
    const toNew = await complete(next, { kind: "new-sprint" });
    expect(toNew.body.carriedOverTo).toMatchObject({ number: 3, name: "Sprint 3", status: "planned" });
    expect((await viewer.get("/api/v2/issues/DEV-1")).body.sprintId).toBe(toNew.body.carriedOverTo.id);
  });

  it("only completes the active sprint, into a planned sprint of the same project", async () => {
    const { id } = (await newSprint()).body;
    expect((await complete(id, { kind: "backlog" })).body.code).toBe("SPRINT_NOT_ACTIVE");

    await start(id);
    const res = await complete(id, { kind: "sprint", sprintId: id });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe("carryOver.sprintId");
  });

  it("records the carry-over for burndown", async () => {
    const { id } = (await newSprint()).body;
    await issueIn(id, { estimate: 3 });
    await start(id);

    await complete(id, { kind: "backlog" });

    const last = await prisma.issueEvent.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(last).toMatchObject({ kind: "sprint", sprintId: null, estimate: 3 });
  });
});
