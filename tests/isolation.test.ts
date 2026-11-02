import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed.js";
import { seedTeam } from "./helpers/team.js";
import { createLogger } from "../src/lib/logger.js";
import { hashPassword } from "../src/lib/password.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
afterAll(close);

let acme: ReturnType<typeof asBrowser>;
let globex: ReturnType<typeof asBrowser>;
let hankId = "";

/**
 * Two workspaces side by side: the seeded Acme Inc and Globex, whose only member is Hank. Both
 * have a DEV project, so every lookup by key has to be scoped to the caller's workspace.
 */
beforeAll(async () => {
  await truncateAll(prisma);
  await seedTeam(prisma, createLogger(env));
  const workspace = await prisma.workspace.create({ data: { name: "Globex", slug: "globex" } });
  const hank = await prisma.user.create({
    data: {
      email: "hank@globex.dev",
      name: "Hank Scorpio",
      handle: "hank",
      gradient: "from-amber-500 to-orange-600",
      passwordHash: await hashPassword(DEMO_PASSWORD),
      memberships: { create: { workspaceId: workspace.id, role: "admin" } },
    },
  });
  hankId = hank.id;

  acme = asBrowser(app, await signIn(app, "demo@devflow.local"));
  globex = asBrowser(app, await signIn(app, "hank@globex.dev"));
  await globex.post("/api/v2/workspaces/globex/projects").send({ name: "Globex Core", key: "DEV" });
  await globex.post("/api/v2/workspaces/globex/projects/DEV/issues").send({ title: "Globex secret plan" });
});

describe("workspace isolation", () => {
  it("lists only the caller's own projects", async () => {
    const [mine, theirs] = await Promise.all([
      acme.get("/api/v2/workspaces/acme-inc/projects"),
      globex.get("/api/v2/workspaces/globex/projects"),
    ]);

    expect(mine.body.items.map((p: { key: string }) => p.key)).toEqual(["DEV", "BIL", "MOB"]);
    expect(theirs.body.items.map((p: { name: string }) => p.name)).toEqual(["Globex Core"]);
  });

  it("resolves the same project and issue keys in each workspace separately", async () => {
    const [mine, theirs] = await Promise.all([
      acme.get("/api/v2/workspaces/acme-inc/issues/DEV-1"),
      globex.get("/api/v2/workspaces/globex/issues/DEV-1"),
    ]);

    expect(theirs.body.title).toBe("Globex secret plan");
    expect(mine.body.title).not.toBe("Globex secret plan");
    expect((await acme.get("/api/v2/workspaces/acme-inc/projects/DEV/snapshot")).body.project.name).toBe(
      "DevFlow Core",
    );
  });

  it("lists only the caller's own members", async () => {
    const res = await globex.get("/api/v2/workspaces/globex/members");

    expect(res.body.items.map((m: { email: string }) => m.email)).toEqual(["hank@globex.dev"]);
    expect((await globex.get("/api/v2/workspaces/globex")).body).toMatchObject({ name: "Globex", role: "admin" });
  });

  it("does not let one workspace assign or manage another's people", async () => {
    const assign = await acme
      .post("/api/v2/workspaces/acme-inc/projects/DEV/issues")
      .send({ title: "x", assigneeId: hankId });
    const demote = await acme.patch(`/api/v2/workspaces/acme-inc/members/${hankId}`).send({ role: "viewer" });
    const remove = await acme.delete(`/api/v2/workspaces/acme-inc/members/${hankId}`);

    expect(assign.status).toBe(422);
    expect(demote.status).toBe(404);
    expect(remove.status).toBe(404);
    expect(await prisma.workspaceMember.findFirst({ where: { userId: hankId } })).toMatchObject({ role: "admin" });
  });

  it("keeps a token in the workspace it was created in", async () => {
    const created = await globex.post("/api/v2/me/tokens").send({
      name: "ci",
      scopes: ["issues:read"],
      expiresInDays: null,
      workspace: "globex",
    });
    const bearer = { Authorization: `Bearer ${created.body.secret as string}` };

    expect(created.body.token.workspace).toMatchObject({ slug: "globex", name: "Globex" });
    expect((await request(app).get("/api/v2/workspaces/globex/projects").set(bearer)).status).toBe(200);
  });

  it("answers 404 for another workspace's routes, as for one that does not exist", async () => {
    for (const path of ["", "/projects", "/projects/DEV/snapshot", "/issues/DEV-1", "/members", "/nope"]) {
      const [theirs, unknown] = await Promise.all([
        acme.get(`/api/v2/workspaces/globex${path}`),
        acme.get(`/api/v2/workspaces/no-such-workspace${path}`),
      ]);
      expect([theirs.status, theirs.body.code]).toEqual([404, "NOT_FOUND"]);
      expect(theirs.body.detail).toBe(unknown.body.detail);
    }
    const write = await acme.post("/api/v2/workspaces/globex/projects/DEV/issues").send({ title: "Sneaky" });
    expect(write.status).toBe(404);
    expect(await prisma.issue.count({ where: { title: "Sneaky" } })).toBe(0);
  });

  it("loses access to a workspace as soon as the membership ends", async () => {
    const cookie = await signIn(app, "hank@globex.dev");
    await prisma.workspaceMember.deleteMany({ where: { userId: hankId } });

    expect((await asBrowser(app, cookie).get("/api/v2/workspaces/globex/projects")).status).toBe(404);
    expect((await asBrowser(app, cookie).get("/api/v2/auth/me")).body.workspaces).toEqual([]);
  });
});
