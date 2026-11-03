import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { deleteInactiveSampleWorkspaces } from "../src/demo/cleanup.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
const logger = createLogger(env);
afterAll(close);

const DAY = 24 * 60 * 60 * 1000;
const TTL_DAYS = 30;

async function signUp(name: string, address: string) {
  const res = await request(app)
    .post("/api/v2/auth/signup")
    .set("Origin", FRONTEND_ORIGIN)
    .send({ name, email: address, password: "correct horse battery" });
  return { browser: asBrowser(app, sessionCookieHeader(res)), slug: res.body.workspaces[0].slug as string };
}
const age = (slug: string, days: number) =>
  prisma.workspace.update({ where: { slug }, data: { lastActivityAt: new Date(Date.now() - days * DAY) } });
const exists = async (slug: string) => (await prisma.workspace.count({ where: { slug } })) === 1;

beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, logger, undefined, { tracker: true });
});

describe("deleteInactiveSampleWorkspaces (npm run cleanup:workspaces)", () => {
  it("deletes untouched sample workspaces and keeps the account", async () => {
    const ada = await signUp("Ada Lovelace", "ada@acme.dev");
    await age(ada.slug, TTL_DAYS + 1);

    expect(await deleteInactiveSampleWorkspaces(prisma, logger, TTL_DAYS)).toBe(1);

    expect(await exists(ada.slug)).toBe(false);
    expect(await prisma.user.count({ where: { email: "ada@acme.dev" } })).toBe(1);
    expect((await ada.browser.get("/api/v2/auth/me")).body.workspaces).toEqual([]);
  });

  it("keeps workspaces that are recent, shared, invited to, have own projects, are empty or are the demo", async () => {
    const recent = await signUp("Recent", "recent@acme.dev");
    const shared = await signUp("Shared", "shared@acme.dev");
    const invited = await signUp("Invited", "invited@acme.dev");
    const own = await signUp("Own", "own@acme.dev");
    const empty = await signUp("Empty", "empty@acme.dev");
    await age(recent.slug, TTL_DAYS - 1);

    const sharedWorkspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: shared.slug } });
    const other = await prisma.user.findUniqueOrThrow({ where: { email: "own@acme.dev" } });
    await prisma.workspaceMember.create({
      data: { workspaceId: sharedWorkspace.id, userId: other.id, role: "member" },
    });
    await invited.browser
      .post(`/api/v2/workspaces/${invited.slug}/invites`)
      .send({ email: "x@acme.dev", role: "member" });
    await own.browser.post(`/api/v2/workspaces/${own.slug}/projects`).send({ name: "Mine", key: "MINE" });
    await prisma.project.deleteMany({ where: { workspace: { slug: empty.slug } } });
    for (const slug of [shared.slug, invited.slug, own.slug, empty.slug, "acme-inc"]) await age(slug, TTL_DAYS + 1);

    expect(await deleteInactiveSampleWorkspaces(prisma, logger, TTL_DAYS)).toBe(0);

    for (const slug of [recent.slug, shared.slug, invited.slug, own.slug, empty.slug, "acme-inc"]) {
      expect(await exists(slug)).toBe(true);
    }
  });
});

describe("workspace activity", () => {
  it("is recorded when a member opens the workspace, at most once an hour", async () => {
    const ada = await signUp("Ada Lovelace", "ada@acme.dev");
    await age(ada.slug, TTL_DAYS + 1);

    await ada.browser.get(`/api/v2/workspaces/${ada.slug}/projects`);
    const touched = (await prisma.workspace.findUniqueOrThrow({ where: { slug: ada.slug } })).lastActivityAt;
    await ada.browser.get(`/api/v2/workspaces/${ada.slug}/projects`);
    const again = (await prisma.workspace.findUniqueOrThrow({ where: { slug: ada.slug } })).lastActivityAt;

    expect(Date.now() - touched.getTime()).toBeLessThan(60_000);
    expect(again).toEqual(touched);
    expect(await deleteInactiveSampleWorkspaces(prisma, logger, TTL_DAYS)).toBe(0);
  });
});
