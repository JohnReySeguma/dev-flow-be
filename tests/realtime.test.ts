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
