import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { FRONTEND_ORIGIN } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";
import { connected, eventMatching, join, nextEvent, startRealtimeTestServer } from "./helpers/realtime.js";
import { asBrowser, signIn } from "./helpers/session.js";

const server = await startRealtimeTestServer();
const { app, env, prisma, client } = server;
afterAll(() => server.close());

let cookie = "";
beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env));
  cookie = await signIn(app, "member@devflow.local");
});

describe("connecting", () => {
  it("accepts the session cookie from the frontend's origin", async () => {
    await expect(connected(client({ cookie, origin: FRONTEND_ORIGIN }))).resolves.toBeUndefined();
  });

  it("accepts a personal access token", async () => {
    const admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
    const { secret } = (
      await admin.post("/api/v1/me/tokens").send({ name: "cli", scopes: ["issues:read"], expiresInDays: null })
    ).body;

    await expect(connected(client({ token: secret }))).resolves.toBeUndefined();
  });

  it("refuses anonymous connections with the API's error code", async () => {
    const error = await connected(client({ origin: FRONTEND_ORIGIN })).catch((e: unknown) => e);

    expect(error).toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  it("refuses a malformed cookie without crashing, and keeps serving", async () => {
    const error = await connected(client({ cookie: "devflow_access=%E0%A4%A", origin: FRONTEND_ORIGIN })).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await expect(connected(client({ cookie, origin: FRONTEND_ORIGIN }))).resolves.toBeUndefined();
  });

  it("refuses a session cookie sent from another site", async () => {
    await expect(connected(client({ cookie, origin: "https://evil.example" }))).rejects.toBeDefined();
  });
});

describe("project rooms and presence", () => {
  it("joins a project by key and announces who is online", async () => {
    const socket = client({ cookie, origin: FRONTEND_ORIGIN });
    await connected(socket);
    const presence = nextEvent<{ projectKey: string; online: string[] }>(socket, "presence.updated");

    expect(await join(socket, "dev")).toEqual({ ok: true, projectKey: "DEV" });
    const dmitri = await prisma.user.findUniqueOrThrow({ where: { email: "member@devflow.local" } });
    expect(await presence).toMatchObject({ projectKey: "DEV", online: [dmitri.id] });
  });

  it("refuses an unknown project", async () => {
    const socket = client({ cookie, origin: FRONTEND_ORIGIN });
    await connected(socket);

    expect(await join(socket, "NOPE")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("tells the room when someone leaves", async () => {
    const watcher = client({ cookie: await signIn(app, "viewer@devflow.local"), origin: FRONTEND_ORIGIN });
    const leaver = client({ cookie, origin: FRONTEND_ORIGIN });
    await Promise.all([connected(watcher), connected(leaver)]);
    await join(watcher, "DEV");
    const bothOnline = eventMatching<{ online: string[] }>(watcher, "presence.updated", (p) => p.online.length === 2);
    await join(leaver, "DEV");
    await bothOnline;

    const update = eventMatching<{ online: string[] }>(watcher, "presence.updated", (p) => p.online.length === 1);
    leaver.disconnect();

    const lucas = await prisma.user.findUniqueOrThrow({ where: { email: "viewer@devflow.local" } });
    expect((await update).online).toEqual([lucas.id]);
  });
});

describe("without Redis", () => {
  it("still connects and joins with the in-memory adapter", async () => {
    const memory = await startRealtimeTestServer({ env: { REDIS_URL: undefined } });
    try {
      const socket = memory.client({
        cookie: await signIn(memory.app, "member@devflow.local"),
        origin: FRONTEND_ORIGIN,
      });
      await connected(socket);
      expect((await join(socket, "DEV")).ok).toBe(true);
    } finally {
      await memory.close();
    }
  });
});

// Event payloads are checked by the assertions, not by types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;

describe("Live Sync events", () => {
  let member: ReturnType<typeof asBrowser>;
  let actorId = "";
  async function joinedTo(key: string) {
    const socket = client({ cookie: await signIn(app, "viewer@devflow.local"), origin: FRONTEND_ORIGIN });
    await connected(socket);
    await join(socket, key);
    return socket;
  }
  beforeEach(async () => {
    member = asBrowser(app, cookie);
    actorId = (await prisma.user.findUniqueOrThrow({ where: { email: "member@devflow.local" } })).id;
  });

  it("broadcasts created, moved, updated and deleted issues to the project's room", async () => {
    const socket = await joinedTo("DEV");

    const created = nextEvent<Payload>(socket, "issue.created");
    await member.post("/api/v1/projects/DEV/issues").send({ title: "Live!" });
    expect(await created).toMatchObject({ projectKey: "DEV", actorId, issue: { id: "DEV-134", title: "Live!" } });

    const moved = nextEvent<Payload>(socket, "issue.moved");
    await member.post("/api/v1/issues/DEV-134/move").send({ beforeIssueKey: "DEV-104" });
    expect(await moved).toMatchObject({ issue: { id: "DEV-134" }, beforeIssueKey: "DEV-104" });

    const commented = nextEvent<Payload>(socket, "issue.updated");
    await member.post("/api/v1/issues/DEV-134/comments").send({ body: "On it." });
    expect((await commented).issue.comments).toBe(1);

    const deleted = nextEvent<Payload>(socket, "issue.deleted");
    await member.delete("/api/v1/issues/DEV-134");
    expect(await deleted).toEqual({ projectKey: "DEV", actorId, issueKey: "DEV-134" });
  });

  it("only reaches clients in that project's room", async () => {
    const elsewhere = await joinedTo("BIL");
    let received = false;
    elsewhere.on("issue.created", () => {
      received = true;
    });
    const here = await joinedTo("DEV");

    const created = nextEvent(here, "issue.created");
    await member.post("/api/v1/projects/DEV/issues").send({ title: "Only DEV hears this" });
    await created;

    expect(received).toBe(false);
  });

  it("broadcasts the sprint lifecycle, with the carried-over issues on completion", async () => {
    const socket = await joinedTo("BIL");
    const sprint8 = (await prisma.sprint.findFirstOrThrow({ where: { number: 8, project: { key: "BIL" } } })).id;

    const completed = nextEvent<Payload>(socket, "sprint.completed");
    await member.post(`/api/v1/sprints/${sprint8}/complete`).send({ carryOver: { kind: "new-sprint" } });
    const payload = await completed;

    expect(payload.sprint).toMatchObject({ number: 8, status: "completed" });
    expect(payload.carriedOverTo).toMatchObject({ number: 9, status: "planned" });
    expect(payload.issues.map((i: { id: string }) => i.id).sort()).toEqual([
      "BIL-41",
      "BIL-44",
      "BIL-45",
      "BIL-47",
      "BIL-48",
    ]);
    expect(payload.issues.every((i: { sprintId: string }) => i.sprintId === payload.carriedOverTo.id)).toBe(true);

    const started = nextEvent<Payload>(socket, "sprint.started");
    await member.post(`/api/v1/sprints/${payload.carriedOverTo.id}/start`).send({ name: "Sprint 9", durationDays: 14 });
    expect((await started).sprint).toMatchObject({ number: 9, status: "active" });
  });

  it("broadcasts workflow and project changes", async () => {
    const socket = await joinedTo("DEV");
    const admin = asBrowser(app, await signIn(app, "demo@devflow.local"));

    const workflow = nextEvent<Payload>(socket, "workflow.updated");
    await admin.post("/api/v1/projects/DEV/statuses").send({ name: "QA", category: "in_progress" });
    expect((await workflow).project.workflow.map((s: { name: string }) => s.name)).toContain("QA");

    const project = nextEvent<Payload>(socket, "project.updated");
    await admin.patch("/api/v1/projects/DEV").send({ description: "Live." });
    expect((await project).project.description).toBe("Live.");
  });
});
