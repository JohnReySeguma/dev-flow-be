import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/lib/logger.js";
import { FRONTEND_ORIGIN, setCookies } from "./helpers/cookies.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { seedTeam } from "./helpers/team.js";
import { connected, join, nextEvent, startRealtimeTestServer } from "./helpers/realtime.js";
import { asBrowser, signIn } from "./helpers/session.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket payloads are untyped JSON
type Payload = Record<string, any>;

const SECRET = "whsec_test_placeholder";
// The integration is enabled by an App id, slug and client credentials, a webhook secret and a
// non-empty key file; the key is never read.
const keyDir = mkdtempSync(joinPath(tmpdir(), "devflow-github-"));
const keyPath = joinPath(keyDir, "app.pem");
writeFileSync(keyPath, "placeholder");

/** The linked installation every delivery comes from unless a test says otherwise. */
const INSTALLATION = 51234567;
/** What the fake GitHub says the installing user can access; tests adjust it. */
let accessible = [{ id: INSTALLATION, account: { login: "acme", type: "Organization" } }];

const fakeFetch = ((input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://github.com/login/oauth/access_token")) {
    return Promise.resolve(Response.json({ access_token: "ghu_test" }));
  }
  if (url.startsWith("https://api.github.com/user/installations")) {
    return Promise.resolve(Response.json({ total_count: accessible.length, installations: accessible }));
  }
  return Promise.resolve(new Response("unexpected", { status: 500 }));
}) as typeof fetch;

const server = await startRealtimeTestServer({
  env: {
    GITHUB_APP_ID: "1",
    GITHUB_WEBHOOK_SECRET: SECRET,
    GITHUB_APP_PRIVATE_KEY_PATH: keyPath,
    GITHUB_APP_SLUG: "devflow-test",
    GITHUB_APP_CLIENT_ID: "Iv1.test",
    GITHUB_APP_CLIENT_SECRET: "test-secret",
  },
  fetch: fakeFetch,
});
const { app, env, prisma, client } = server;
afterAll(async () => {
  await server.close();
  rmSync(keyDir, { recursive: true, force: true });
});

const WEBHOOK = "/api/integrations/github/webhook";
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/** Signs and posts a delivery; it comes from the linked installation unless the payload names one. */
function deliver(event: string, payload: object, signature?: string) {
  const body = JSON.stringify("installation" in payload ? payload : { ...payload, installation: { id: INSTALLATION } });
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
const issue = async (key: string) => (await member.get(`/api/v2/workspaces/acme-inc/issues/${key}`)).body as Payload;

beforeEach(async () => {
  await truncateAll(prisma);
  await seedTeam(prisma, createLogger(env), undefined, { tracker: false });
  accessible = [{ id: INSTALLATION, account: { login: "acme", type: "Organization" } }];
  const acme = await prisma.workspace.findUniqueOrThrow({ where: { slug: "acme-inc" } });
  await prisma.gitHubInstallation.create({
    data: { installationId: BigInt(INSTALLATION), workspaceId: acme.id, accountLogin: "acme" },
  });
  member = asBrowser(app, await signIn(app, "member@devflow.local"));
  await member.post("/api/v2/workspaces/acme-inc/projects").send({ name: "DevFlow Core", key: "DEV" });
  for (const title of ["Token refresh", "Idempotency keys", "Docs"]) {
    await member.post("/api/v2/workspaces/acme-inc/projects/DEV/issues").send({ title });
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
    const project = (await member.get("/api/v2/workspaces/acme-inc/projects/DEV")).body as Payload;
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
    expect(await moved).toMatchObject({
      actorId: null,
      issue: { id: "DEV-1", resolvedAt: expect.any(String) },
      // Merging changes the status, not the ranking: new issues go on top, so DEV-1 stays last.
      beforeIssueKey: null,
    });
  });
});

describe("installations per workspace", () => {
  it("ignores deliveries from an installation that is not linked to any workspace", async () => {
    const res = await deliver("pull_request", {
      ...pr("opened", { number: 9, title: "DEV-1 elsewhere", ref: "main" }),
      installation: { id: 999 },
    });

    expect(res.status).toBe(202);
    expect(res.body.handled).toBe(false);
    expect((await issue("DEV-1")).git).toBeUndefined();
  });

  it("changes issues only in the workspace the installation is linked to", async () => {
    const globex = await prisma.workspace.create({ data: { name: "Globex", slug: "globex" } });
    const project = await prisma.project.create({
      data: {
        workspaceId: globex.id,
        key: "DEV",
        name: "Globex Core",
        color: "from-sky-500 to-cyan-500",
        nextIssueNumber: 2,
      },
    });
    const status = await prisma.workflowStatus.create({
      data: { projectId: project.id, name: "To Do", category: "todo", position: 0 },
    });
    await prisma.issue.create({
      data: {
        projectId: project.id,
        number: 1,
        statusId: status.id,
        type: "task",
        priority: "low",
        title: "Globex",
        rank: "a0",
      },
    });

    await deliver("pull_request", pr("opened", { number: 12, title: "DEV-1 fix", ref: "main" }));

    expect((await issue("DEV-1")).git).toEqual({ kind: "pr", number: 12, state: "open" });
    expect((await prisma.issue.findFirstOrThrow({ where: { projectId: project.id } })).git).toBeNull();
  });

  it("unlinks the installation when the App is uninstalled on GitHub", async () => {
    const res = await deliver("installation", { action: "deleted", installation: { id: INSTALLATION } });

    expect(res.status).toBe(200);
    expect(await prisma.gitHubInstallation.count()).toBe(0);
  });
});

describe("linking an installation", () => {
  const SETTINGS = "/api/v2/workspaces/acme-inc/integrations/github";
  let admin: ReturnType<typeof asBrowser>;
  beforeEach(async () => {
    await prisma.gitHubInstallation.deleteMany();
    admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
  });

  /** Starts the install as an admin and returns GitHub's redirect URL and the state cookie. */
  async function startInstall(as = admin) {
    const start = await as.get(`${SETTINGS}/install?redirect=/settings/integrations`);
    const cookie = setCookies(start).devflow_github;
    return {
      start,
      location: new URL(String(start.headers.location)),
      cookie: `devflow_github=${cookie?.value ?? ""}`,
    };
  }
  const finish = (query: Record<string, string>, cookie?: string) => {
    const req = request(app).get(`/api/integrations/github/setup?${new URLSearchParams(query).toString()}`);
    return cookie ? req.set("Cookie", cookie) : req;
  };

  it("sends the admin to GitHub's install page with a signed state in a cookie", async () => {
    const { start, location } = await startInstall();

    expect(start.status).toBe(302);
    expect(location.origin + location.pathname).toBe("https://github.com/apps/devflow-test/installations/new");
    expect(location.searchParams.get("state")).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(setCookies(start).devflow_github?.attributes).toMatch(
      /Path=\/api\/integrations\/github;.*HttpOnly;.*Secure/,
    );
  });

  it("links the installation when GitHub confirms the user can access it", async () => {
    const { location, cookie } = await startInstall();
    const state = location.searchParams.get("state") ?? "";

    const res = await finish(
      { code: "gh-code", installation_id: String(INSTALLATION), setup_action: "install", state },
      cookie,
    );

    expect(res.headers.location).toBe(`${FRONTEND_ORIGIN}/settings/integrations?github=linked`);
    const status = await admin.get(SETTINGS);
    expect(status.body).toEqual({
      enabled: true,
      installations: [{ installationId: INSTALLATION, account: "acme", linkedAt: expect.any(String) }],
    });
  });

  it.each([
    ["without the state cookie", { cookie: false }, "github_state_mismatch"],
    ["for an installation the user cannot access", { id: "424242" }, "github_not_your_installation"],
    ["when the user cancelled on GitHub", { code: "" }, "github_denied"],
  ])("refuses %s", async (_label, change: { cookie?: boolean; id?: string; code?: string }, code) => {
    const { location, cookie } = await startInstall();
    const query = {
      code: change.code ?? "gh-code",
      installation_id: change.id ?? String(INSTALLATION),
      setup_action: "install",
      state: location.searchParams.get("state") ?? "",
    };

    const res = await finish(query, change.cookie === false ? undefined : cookie);

    // Without a verified state the redirect cannot be trusted either, so it falls back to /projects.
    const page = code === "github_state_mismatch" ? "/projects" : "/settings/integrations";
    expect(res.headers.location).toBe(`${FRONTEND_ORIGIN}${page}?github_error=${code}`);
    expect(await prisma.gitHubInstallation.count()).toBe(0);
  });

  it("refuses an installation that is already linked to another workspace", async () => {
    const globex = await prisma.workspace.create({ data: { name: "Globex", slug: "globex" } });
    await prisma.gitHubInstallation.create({
      data: { installationId: BigInt(INSTALLATION), workspaceId: globex.id, accountLogin: "acme" },
    });
    const { location, cookie } = await startInstall();

    const res = await finish(
      {
        code: "gh-code",
        installation_id: String(INSTALLATION),
        setup_action: "install",
        state: location.searchParams.get("state") ?? "",
      },
      cookie,
    );

    expect(res.headers.location).toContain("github_error=github_installation_taken");
  });

  it("lets admins only start an install or unlink, and anyone read the status", async () => {
    await prisma.gitHubInstallation.create({
      data: {
        installationId: BigInt(INSTALLATION),
        workspaceId: (await prisma.workspace.findUniqueOrThrow({ where: { slug: "acme-inc" } })).id,
        accountLogin: "acme",
      },
    });

    expect((await member.get(`${SETTINGS}/install`)).status).toBe(403);
    expect((await member.delete(`${SETTINGS}/installations/${INSTALLATION}`)).status).toBe(403);
    expect((await member.get(SETTINGS)).body.installations).toHaveLength(1);
    expect((await admin.delete(`${SETTINGS}/installations/${INSTALLATION}`)).status).toBe(204);
    expect((await admin.delete(`${SETTINGS}/installations/${INSTALLATION}`)).status).toBe(404);
  });
});
