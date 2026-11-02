import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
afterAll(close);

let admin: ReturnType<typeof asBrowser>;
let statuses: Record<"todo" | "progress" | "review" | "done", string>;

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env), undefined, { tracker: false });
  admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
  const project = await admin.post("/api/v2/workspaces/acme-inc/projects").send({ name: "DevFlow Core", key: "DEV" });
  const [todo, progress, review, done] = project.body.workflow.map((s: { id: string }) => s.id);
  statuses = { todo, progress, review, done };
});

const names = (body: { workflow: { name: string }[] }) => body.workflow.map((s) => s.name);
const issueInReview = () =>
  admin
    .post("/api/v2/workspaces/acme-inc/projects/DEV/issues")
    .send({ title: "Waiting for review", statusId: statuses.review });

describe("POST /api/v2/workspaces/acme-inc/projects/:key/statuses", () => {
  it("inserts a new status before the first done status", async () => {
    const res = await admin
      .post("/api/v2/workspaces/acme-inc/projects/DEV/statuses")
      .send({ name: "QA", category: "in_progress" });

    expect(res.status).toBe(201);
    expect(names(res.body)).toEqual(["To Do", "In Progress", "In Review", "QA", "Done"]);
  });

  it("appends a done status at the end", async () => {
    const res = await admin
      .post("/api/v2/workspaces/acme-inc/projects/DEV/statuses")
      .send({ name: "Released", category: "done" });

    expect(names(res.body)).toEqual(["To Do", "In Progress", "In Review", "Done", "Released"]);
  });

  it("changes the project's ETag", async () => {
    const before = (await admin.get("/api/v2/workspaces/acme-inc/projects/DEV")).headers.etag;

    const res = await admin
      .post("/api/v2/workspaces/acme-inc/projects/DEV/statuses")
      .send({ name: "QA", category: "in_progress" });

    expect(res.headers.etag).not.toBe(before);
  });

  it("is admin-only", async () => {
    const member = asBrowser(app, await signIn(app, "member@devflow.local"));

    expect(
      (await member.post("/api/v2/workspaces/acme-inc/projects/DEV/statuses").send({ name: "QA", category: "todo" }))
        .status,
    ).toBe(403);
  });
});

describe("PATCH /api/v2/workspaces/acme-inc/projects/:key/statuses/:id", () => {
  it("renames a status", async () => {
    const res = await admin
      .patch(`/api/v2/workspaces/acme-inc/projects/DEV/statuses/${statuses.review}`)
      .send({ name: "Code Review" });

    expect(names(res.body)).toContain("Code Review");
  });

  it("resolves the status's issues when it becomes done, and reopens them when it stops", async () => {
    await issueInReview();

    await admin
      .patch(`/api/v2/workspaces/acme-inc/projects/DEV/statuses/${statuses.review}`)
      .send({ category: "done" });
    expect((await admin.get("/api/v2/workspaces/acme-inc/issues/DEV-1")).body.resolvedAt).toEqual(expect.any(String));

    await admin
      .patch(`/api/v2/workspaces/acme-inc/projects/DEV/statuses/${statuses.review}`)
      .send({ category: "in_progress" });
    expect((await admin.get("/api/v2/workspaces/acme-inc/issues/DEV-1")).body.resolvedAt).toBeNull();
    const events = await prisma.issueEvent.findMany({ orderBy: { createdAt: "asc" }, select: { done: true } });
    expect(events.map((e) => e.done)).toEqual([false, true, false]);
  });

  it("keeps at least one to-do and one done status", async () => {
    const res = await admin
      .patch(`/api/v2/workspaces/acme-inc/projects/DEV/statuses/${statuses.todo}`)
      .send({ category: "in_progress" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "STATUS_UPDATE_BLOCKED",
      detail: "Keep at least one To do status so new issues have somewhere to start.",
    });
  });
});

describe("PUT /api/v2/workspaces/acme-inc/projects/:key/statuses/order", () => {
  it("applies a full reorder", async () => {
    const res = await admin
      .put("/api/v2/workspaces/acme-inc/projects/DEV/statuses/order")
      .send({ statusIds: [statuses.todo, statuses.review, statuses.progress, statuses.done] });

    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["To Do", "In Review", "In Progress", "Done"]);
  });

  it.each([
    ["a missing status", (s: typeof statuses) => [s.todo, s.progress, s.done]],
    ["a duplicate", (s: typeof statuses) => [s.todo, s.todo, s.review, s.done]],
    ["a foreign id", (s: typeof statuses) => [s.todo, s.progress, s.review, "0193f1c2-0000-7000-8000-000000000999"]],
  ])("rejects %s", async (_, ids) => {
    const res = await admin
      .put("/api/v2/workspaces/acme-inc/projects/DEV/statuses/order")
      .send({ statusIds: ids(statuses) });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe("statusIds");
  });
});

describe("DELETE /api/v2/workspaces/acme-inc/projects/:key/statuses/:id", () => {
  it("refuses to delete the only to-do or done status", async () => {
    const res = await admin.delete(`/api/v2/workspaces/acme-inc/projects/DEV/statuses/${statuses.done}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STATUS_DELETE_BLOCKED");
  });

  it("requires moveTo when the status has issues", async () => {
    await issueInReview();

    const res = await admin.delete(`/api/v2/workspaces/acme-inc/projects/DEV/statuses/${statuses.review}`);

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe("moveTo");
  });

  it("moves the issues, resolving them if they land in done, then deletes the status", async () => {
    await issueInReview();

    const res = await admin.delete(
      `/api/v2/workspaces/acme-inc/projects/DEV/statuses/${statuses.review}?moveTo=${statuses.done}`,
    );

    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["To Do", "In Progress", "Done"]);
    expect((await admin.get("/api/v2/workspaces/acme-inc/issues/DEV-1")).body).toMatchObject({
      statusId: statuses.done,
      resolvedAt: expect.any(String),
    });
  });

  it("deletes an empty status without moveTo", async () => {
    expect((await admin.delete(`/api/v2/workspaces/acme-inc/projects/DEV/statuses/${statuses.progress}`)).status).toBe(
      200,
    );
  });
});
