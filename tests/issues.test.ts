import request from "supertest";
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
let statuses: Record<"todo" | "progress" | "review" | "done", string>;
let projectId = "";

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env));
  await prisma.project.deleteMany();
  member = asBrowser(app, await signIn(app, "member@devflow.local"));
  viewer = asBrowser(app, await signIn(app, "viewer@devflow.local"));
  const project = await member.post("/api/v1/projects").send({ name: "DevFlow Core", key: "DEV" });
  projectId = project.body.id;
  const [todo, progress, review, done] = project.body.workflow.map((s: { id: string }) => s.id);
  statuses = { todo, progress, review, done };
});

const create = (body: object = {}) =>
  member.post("/api/v1/projects/DEV/issues").send({ title: "Fix the flaky test", ...body });
const sprint = (status: "planned" | "active" | "completed", number: number) =>
  prisma.sprint.create({ data: { projectId, number, name: `Sprint ${number}`, status } });

describe("POST /api/v1/projects/:key/issues", () => {
  it("numbers issues per project and applies the defaults", async () => {
    const first = await create();
    const second = await create({ title: "Second" });

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      id: "DEV-1",
      projectId,
      sprintId: null,
      statusId: statuses.todo,
      type: "task",
      priority: "medium",
      description: "",
      assigneeId: null,
      tags: [],
      estimate: null,
      comments: 0,
      resolvedAt: null,
    });
    expect(first.body).not.toHaveProperty("git");
    expect(first.body).not.toHaveProperty("dueAt");
    expect(second.body.id).toBe("DEV-2");
  });

  it("never hands out the same key twice, even under concurrent creates", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => create({ title: `Parallel ${i}` })));

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(10);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).nextIssueNumber).toBe(11);
  });

  it("marks an issue created straight into a done status as resolved", async () => {
    expect((await create({ statusId: statuses.done })).body.resolvedAt).toEqual(expect.any(String));
  });

  it("puts new issues at the top of the ranking", async () => {
    await create({ title: "Older" });
    await create({ title: "Newer" });

    const list = await viewer.get("/api/v1/projects/DEV/issues");

    expect(list.body.items.map((i: { title: string }) => i.title)).toEqual(["Newer", "Older"]);
  });

  it("checks that references belong to this project and workspace", async () => {
    const other = await member.post("/api/v1/projects").send({ name: "Other", key: "OTH" });
    const completed = await sprint("completed", 1);

    const res = await create({
      statusId: other.body.workflow[0].id,
      sprintId: completed.id,
      assigneeId: "0193f1c2-0000-7000-8000-000000000999",
      estimate: 4,
    });

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(["estimate"]);
    const refs = await create({
      statusId: other.body.workflow[0].id,
      sprintId: completed.id,
      assigneeId: "0193f1c2-0000-7000-8000-000000000999",
    });
    expect(refs.body.errors.map((e: { field: string }) => e.field)).toEqual(["statusId", "sprintId", "assigneeId"]);
  });

  it("is for members and admins only", async () => {
    expect((await viewer.post("/api/v1/projects/DEV/issues").send({ title: "Nope" })).status).toBe(403);
  });
});

describe("GET /api/v1/issues/:issueKey", () => {
  beforeEach(async () => {
    await create({ title: "First" });
  });

  it("finds an issue by key in any case", async () => {
    const res = await viewer.get("/api/v1/issues/dev-1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("DEV-1");
    expect(res.headers.etag).toBeDefined();
  });

  it("accepts a bare number together with ?project=", async () => {
    expect((await viewer.get("/api/v1/issues/1?project=dev")).body.id).toBe("DEV-1");

    const withoutProject = await viewer.get("/api/v1/issues/1");
    expect(withoutProject.status).toBe(422);
    expect(withoutProject.body.errors[0].field).toBe("project");
  });

  it("is 404 for unknown issues and projects", async () => {
    expect((await viewer.get("/api/v1/issues/DEV-99")).status).toBe(404);
    expect((await viewer.get("/api/v1/issues/NOPE-1")).status).toBe(404);
    expect((await viewer.get("/api/v1/issues/not-a-key")).status).toBe(404);
  });
});

describe("PATCH /api/v1/issues/:issueKey", () => {
  beforeEach(async () => {
    await create({ estimate: 3 });
  });

  it("keeps resolvedAt in step with done-ness", async () => {
    const done = await member.patch("/api/v1/issues/DEV-1").send({ statusId: statuses.done });
    expect(done.body.resolvedAt).toEqual(expect.any(String));

    const reopened = await member.patch("/api/v1/issues/DEV-1").send({ statusId: statuses.review });
    expect(reopened.body.resolvedAt).toBeNull();
  });

  it("does not let the client set resolvedAt", async () => {
    const res = await member
      .patch("/api/v1/issues/DEV-1")
      .send({ title: "Renamed", resolvedAt: "2020-01-01T00:00:00Z" });

    expect(res.body).toMatchObject({ title: "Renamed", resolvedAt: null });
  });

  it("records status, sprint and estimate changes for burndown", async () => {
    const active = await sprint("active", 1);

    await member.patch("/api/v1/issues/DEV-1").send({ sprintId: active.id, estimate: 5, statusId: statuses.done });

    const events = await prisma.issueEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.kind)).toEqual(["created", "status", "sprint", "estimate"]);
    expect(events.at(-1)).toMatchObject({ sprintId: active.id, estimate: 5, done: true });
  });

  it("answers 412 CONFLICT_STALE to an outdated If-Match", async () => {
    const { etag } = (await viewer.get("/api/v1/issues/DEV-1")).headers;
    await member.patch("/api/v1/issues/DEV-1").send({ priority: "urgent" });

    const res = await member.patch("/api/v1/issues/DEV-1").set("If-Match", String(etag)).send({ priority: "low" });

    expect(res.status).toBe(412);
    expect((await viewer.get("/api/v1/issues/DEV-1")).body.priority).toBe("urgent");
  });
});

describe("GET /api/v1/projects/:key/issues filters", () => {
  let dmitri = "";
  beforeEach(async () => {
    dmitri = (await prisma.user.findUniqueOrThrow({ where: { email: "member@devflow.local" } })).id;
    const planned = await sprint("planned", 1);
    const active = await sprint("active", 2);
    await create({ title: "Backlog bug", type: "bug", priority: "urgent" });
    await create({ title: "Planned story", type: "story", sprintId: planned.id, assigneeId: dmitri });
    await create({ title: "Active task", sprintId: active.id, description: "mentions the gateway" });
  });

  const titles = async (query: string) =>
    (await viewer.get(`/api/v1/projects/DEV/issues${query}`)).body.items.map((i: { title: string }) => i.title);

  it.each([
    ["?sprint=backlog", ["Backlog bug"]],
    ["?sprint=active", ["Active task"]],
    ["?assignee=none&type=task", ["Active task"]],
    ["?priority=urgent", ["Backlog bug"]],
    ["?q=GATEWAY", ["Active task"]],
    ["?q=DEV-2", ["Planned story"]],
  ])("%s", async (query, expected) => {
    expect(await titles(query)).toEqual(expected);
  });

  it("filters to the caller's own issues with mine=true", async () => {
    const res = await member.get("/api/v1/projects/DEV/issues?mine=true");

    expect(res.body.items.map((i: { assigneeId: string }) => i.assigneeId)).toEqual([dmitri]);
  });

  it("pages in rank order", async () => {
    const first = await viewer.get("/api/v1/projects/DEV/issues?limit=2");
    const second = await viewer.get(`/api/v1/projects/DEV/issues?limit=2&cursor=${first.body.nextCursor}`);

    expect([...first.body.items, ...second.body.items].map((i: { id: string }) => i.id)).toEqual([
      "DEV-3",
      "DEV-2",
      "DEV-1",
    ]);
    expect(second.body.nextCursor).toBeNull();
  });
});

describe("ranking", () => {
  it("orders ranks byte-wise, as fractional indexing requires", async () => {
    await create({ title: "A" });
    await create({ title: "B" });
    await prisma.issue.update({ where: { projectId_number: { projectId, number: 1 } }, data: { rank: "a0" } });
    await prisma.issue.update({ where: { projectId_number: { projectId, number: 2 } }, data: { rank: "Zz" } });

    const list = await viewer.get("/api/v1/projects/DEV/issues");

    expect(list.body.items.map((i: { title: string }) => i.title)).toEqual(["B", "A"]);
  });
});

describe("DELETE /api/v1/issues/:issueKey", () => {
  it("deletes the issue without reusing its number", async () => {
    await create();

    expect((await member.delete("/api/v1/issues/DEV-1")).status).toBe(204);
    expect((await create()).body.id).toBe("DEV-2");
  });

  it("needs issues:write for access tokens", async () => {
    await create();
    const admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
    const { secret } = (
      await admin.post("/api/v1/me/tokens").send({ name: "ro", scopes: ["issues:read"], expiresInDays: null })
    ).body;

    const res = await request(app)
      .delete("/api/v1/issues/DEV-1")
      .set("Authorization", `Bearer ${secret as string}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/issues/:issueKey/move", () => {
  const order = async () =>
    (await viewer.get("/api/v1/projects/DEV/issues")).body.items.map((i: { id: string }) => i.id);
  const move = (key: string, body: object) => member.post(`/api/v1/issues/${key}/move`).send(body);

  beforeEach(async () => {
    for (const title of ["one", "two", "three", "four"]) await create({ title });
    // Newest first: DEV-4, DEV-3, DEV-2, DEV-1.
  });

  it("places an issue directly before another (backlog drag)", async () => {
    const res = await move("DEV-1", { beforeIssueKey: "DEV-3" });

    expect(res.status).toBe(200);
    expect(await order()).toEqual(["DEV-4", "DEV-1", "DEV-3", "DEV-2"]);
  });

  it("can move to the very top", async () => {
    await move("DEV-2", { beforeIssueKey: "DEV-4" });

    expect(await order()).toEqual(["DEV-2", "DEV-4", "DEV-3", "DEV-1"]);
  });

  it("floats an issue to the top when only its status changes (board drop)", async () => {
    const res = await move("DEV-1", { statusId: statuses.done });

    expect(res.body).toMatchObject({ statusId: statuses.done, resolvedAt: expect.any(String) });
    expect((await order())[0]).toBe("DEV-1");
  });

  it("sends an issue to the end when its sprint changes without a target", async () => {
    const planned = await sprint("planned", 1);

    const res = await move("DEV-4", { sprintId: planned.id });

    expect(res.body.sprintId).toBe(planned.id);
    expect((await order()).at(-1)).toBe("DEV-4");
  });

  it("changes sprint and position in one call", async () => {
    const planned = await sprint("planned", 1);
    await move("DEV-3", { sprintId: planned.id });

    await move("DEV-1", { sprintId: planned.id, beforeIssueKey: "DEV-3" });

    expect(
      (await viewer.get(`/api/v1/projects/DEV/issues?sprint=${planned.id}`)).body.items.map(
        (i: { id: string }) => i.id,
      ),
    ).toEqual(["DEV-1", "DEV-3"]);
  });

  it("keeps a consistent order when many moves happen at once", async () => {
    await Promise.all(["DEV-1", "DEV-2", "DEV-3"].map((key) => move(key, { beforeIssueKey: "DEV-4" })));

    const ranks = (await prisma.issue.findMany({ select: { rank: true } })).map((i) => i.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect((await order()).at(-1)).toBe("DEV-4");
  });

  it("records status and sprint changes", async () => {
    const planned = await sprint("planned", 1);

    await move("DEV-1", { statusId: statuses.progress, sprintId: planned.id });

    const kinds = (
      await prisma.issueEvent.findMany({
        where: { issue: { number: 1, projectId } },
        orderBy: { createdAt: "asc" },
      })
    ).map((e) => e.kind);
    expect(kinds).toEqual(["created", "status", "sprint"]);
  });

  it("validates the request", async () => {
    expect((await move("DEV-1", {})).status).toBe(422);
    expect((await move("DEV-1", { beforeIssueKey: "DEV-1" })).body.errors[0].field).toBe("beforeIssueKey");
    expect((await move("DEV-1", { beforeIssueKey: "DEV-99" })).status).toBe(404);
  });
});
