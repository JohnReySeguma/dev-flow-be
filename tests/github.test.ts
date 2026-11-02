import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { FRONTEND_ORIGIN } from "./helpers/cookies.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { connected, join, nextEvent, startRealtimeTestServer } from "./helpers/realtime.js";
import { asBrowser, signIn } from "./helpers/session.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket payloads are untyped JSON
type Payload = Record<string, any>;

const SECRET = "whsec_test_placeholder";
// The integration is enabled by an App id, a webhook secret and a non-empty key file; the key is never read.
const keyDir = mkdtempSync(joinPath(tmpdir(), "devflow-github-"));
const keyPath = joinPath(keyDir, "app.pem");
writeFileSync(keyPath, "placeholder");

const server = await startRealtimeTestServer({
  env: { GITHUB_APP_ID: "1", GITHUB_WEBHOOK_SECRET: SECRET, GITHUB_APP_PRIVATE_KEY_PATH: keyPath },
});
const { app, env, prisma, client } = server;
afterAll(async () => {
  await server.close();
  rmSync(keyDir, { recursive: true, force: true });
});

const WEBHOOK = "/api/v1/integrations/github/webhook";
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function deliver(event: string, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return request(app)
    .post(WEBHOOK)
    .set("content-type", "application/json")
    .set("x-github-event", event)
    .set("x-hub-signature-256", signature ?? sign(body))
    .send(body);
}

const pr = (
  action: string,
  pull: { number: number; title: string; ref: string; draft?: boolean; merged?: boolean },
) => ({
  action,
  pull_request: {
    number: pull.number,
    title: pull.title,
    draft: pull.draft ?? false,
    merged: pull.merged ?? false,
    head: { ref: pull.ref },
  },
});

let member: ReturnType<typeof asBrowser>;
const issue = async (key: string) => (await member.get(`/api/v1/issues/${key}`)).body as Payload;

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env), undefined, { tracker: false });
  member = asBrowser(app, await signIn(app, "member@devflow.local"));
  await member.post("/api/v1/projects").send({ name: "DevFlow Core", key: "DEV" });
  for (const title of ["Token refresh", "Idempotency keys", "Docs"]) {
    await member.post("/api/v1/projects/DEV/issues").send({ title });
  }
});

describe("signature", () => {
  it("rejects deliveries without a valid signature", async () => {
    const missing = await request(app).post(WEBHOOK).set("x-github-event", "ping").send("{}");
    const forged = await deliver("ping", { zen: "hi" }, sign('{"zen":"hi"}', "another-secret"));

    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe("WEBHOOK_SIGNATURE_INVALID");
    expect(forged.status).toBe(401);
  });

  it("answers GitHub's ping", async () => {
    const res = await deliver("ping", { zen: "Keep it logically awesome." });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ event: "ping", handled: true, issues: [] });
  });

  it("refuses a signed body that is not JSON", async () => {
    const res = await request(app)
      .post(WEBHOOK)
      .set("content-type", "application/json")
      .set("x-github-event", "push")
      .set("x-hub-signature-256", sign("not json"))
      .send("not json");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("acknowledges events it does not handle with 202", async () => {
    const res = await deliver("issues", { action: "opened" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ event: "issues", handled: false, issues: [] });
  });

  it("is not found when the integration is not configured", async () => {
    const plain = createTestApp();
    const body = "{}";
    const res = await request(plain.app)
      .post(WEBHOOK)
      .set("content-type", "application/json")
      .set("x-github-event", "ping")
      .set("x-hub-signature-256", sign(body))
      .send(body);
    await plain.close();

    expect(res.status).toBe(404);
  });
});

describe("pull requests", () => {
  it("links the issues named in the title and branch", async () => {
    const res = await deliver(
      "pull_request",
      pr("opened", { number: 421, title: "Fix DEV-2 retries", ref: "dev-1-token-refresh", draft: true }),
    );

    expect(res.status).toBe(200);
    expect(res.body.issues.sort()).toEqual(["DEV-1", "DEV-2"]);
    expect((await issue("DEV-1")).git).toEqual({ kind: "pr", number: 421, state: "draft" });
    expect((await issue("DEV-3")).git).toBeUndefined();
  });

  it("moves the issue to Done when the pull request is merged", async () => {
    await deliver("pull_request", pr("opened", { number: 421, title: "DEV-1", ref: "main-fix" }));
    await deliver("pull_request", pr("closed", { number: 421, title: "DEV-1", ref: "main-fix", merged: true }));

    const merged = await issue("DEV-1");
    const project = (await member.get("/api/v1/projects/DEV")).body as Payload;
    const done = (project.workflow as Payload[]).find((s) => s.category === "done");
    expect(merged.git).toEqual({ kind: "pr", number: 421, state: "merged" });
    expect(merged.statusId).toBe(done?.id);
    expect(merged.resolvedAt).not.toBeNull();
    expect(await prisma.issueEvent.count({ where: { kind: "status", actorId: null, issue: { number: 1 } } })).toBe(1);
  });

  it("removes its link when closed without merging, but not another PR's", async () => {
    await deliver("pull_request", pr("opened", { number: 421, title: "DEV-1", ref: "a" }));
    await deliver("pull_request", pr("opened", { number: 430, title: "DEV-2", ref: "b" }));

    await deliver("pull_request", pr("closed", { number: 421, title: "DEV-1", ref: "a" }));
    await deliver("pull_request", pr("closed", { number: 999, title: "DEV-2", ref: "c" }));

    expect((await issue("DEV-1")).git).toBeUndefined();
    expect((await issue("DEV-2")).git).toEqual({ kind: "pr", number: 430, state: "open" });
  });

  it("ignores unknown keys and actions that change nothing", async () => {
    const unknown = await deliver("pull_request", pr("opened", { number: 1, title: "UTF-8 and BIL-41", ref: "x" }));
    const labeled = await deliver("pull_request", pr("labeled", { number: 1, title: "DEV-1", ref: "x" }));

    expect(unknown.body).toEqual({ event: "pull_request", handled: true, issues: [] });
    expect(labeled.status).toBe(202);
    expect((await issue("DEV-1")).git).toBeUndefined();
  });
});

describe("pushes", () => {
  const push = (commits: { id: string; message: string }[], ref = "refs/heads/main") => ({
    ref,
    commits,
    head_commit: commits.at(-1) ?? null,
  });

  it("links each mentioned issue to its latest commit, and the branch's issue to the head", async () => {
    const res = await deliver(
      "push",
      push(
        [
          { id: "a8f91c2d000000000000000000000000000000aa", message: "DEV-2: first pass" },
          { id: "b7e6d5c4000000000000000000000000000000bb", message: "DEV-2: tests" },
        ],
        "refs/heads/dev-3-docs",
      ),
    );

    expect(res.body.issues.sort()).toEqual(["DEV-2", "DEV-3"]);
    expect((await issue("DEV-2")).git).toEqual({ kind: "commit", sha: "b7e6d5c" });
    expect((await issue("DEV-3")).git).toEqual({ kind: "commit", sha: "b7e6d5c" });
  });

  it("keeps a pull request link over a commit", async () => {
    await deliver("pull_request", pr("opened", { number: 421, title: "DEV-1", ref: "x" }));
    await deliver("push", push([{ id: "c0ffee0000", message: "More DEV-1 work" }]));

    expect((await issue("DEV-1")).git).toEqual({ kind: "pr", number: 421, state: "open" });
  });

  it("ignores a deleted branch", async () => {
    const res = await deliver("push", { ref: "refs/heads/dev-1-x", deleted: true, commits: [], head_commit: null });

    expect(res.status).toBe(202);
  });
});

describe("Live Sync", () => {
  it("broadcasts webhook changes with a null actor", async () => {
    const socket = client({ cookie: await signIn(app, "viewer@devflow.local"), origin: FRONTEND_ORIGIN });
    await connected(socket);
    await join(socket, "DEV");

    const updated = nextEvent<Payload>(socket, "issue.updated");
    await deliver("pull_request", pr("opened", { number: 421, title: "DEV-1", ref: "x" }));
    expect(await updated).toMatchObject({
      projectKey: "DEV",
      actorId: null,
      issue: { id: "DEV-1", git: { kind: "pr", number: 421, state: "open" } },
    });

    const moved = nextEvent<Payload>(socket, "issue.moved");
    await deliver("pull_request", pr("closed", { number: 421, title: "DEV-1", ref: "x", merged: true }));
    expect(await moved).toMatchObject({ actorId: null, issue: { id: "DEV-1", resolvedAt: expect.any(String) } });
  });
});
