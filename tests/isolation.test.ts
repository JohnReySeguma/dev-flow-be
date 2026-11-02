import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, seed } from "../prisma/seed.js";
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
  await seed(prisma, createLogger(env));
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
  await globex.post("/api/v2/projects").send({ name: "Globex Core", key: "DEV" });
  await globex.post("/api/v2/projects/DEV/issues").send({ title: "Globex secret plan" });
});

describe("workspace isolation", () => {
  it("lists only the caller's own projects", async () => {
    const [mine, theirs] = await Promise.all([acme.get("/api/v2/projects"), globex.get("/api/v2/projects")]);

    expect(mine.body.items.map((p: { key: string }) => p.key)).toEqual(["DEV", "BIL", "MOB"]);
    expect(theirs.body.items.map((p: { name: string }) => p.name)).toEqual(["Globex Core"]);
  });

  it("resolves the same project and issue keys in each workspace separately", async () => {
    const [mine, theirs] = await Promise.all([acme.get("/api/v2/issues/DEV-1"), globex.get("/api/v2/issues/DEV-1")]);

    expect(theirs.body.title).toBe("Globex secret plan");
    expect(mine.body.title).not.toBe("Globex secret plan");
    expect((await acme.get("/api/v2/projects/DEV/snapshot")).body.project.name).toBe("DevFlow Core");
  });

  it("lists only the caller's own members", async () => {
    const res = await globex.get("/api/v2/workspace/members");

    expect(res.body.items.map((m: { email: string }) => m.email)).toEqual(["hank@globex.dev"]);
    expect((await globex.get("/api/v2/workspace")).body).toMatchObject({ name: "Globex", role: "admin" });
  });

  it("does not let one workspace assign or manage another's people", async () => {
    const assign = await acme.post("/api/v2/projects/DEV/issues").send({ title: "x", assigneeId: hankId });
    const demote = await acme.patch(`/api/v2/workspace/members/${hankId}`).send({ role: "viewer" });
    const remove = await acme.delete(`/api/v2/workspace/members/${hankId}`);

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
    });

    const token = await prisma.accessToken.findUniqueOrThrow({ where: { id: created.body.token.id } });
    expect(token.workspaceId).toBe((await prisma.workspace.findUniqueOrThrow({ where: { slug: "globex" } })).id);
  });

  it("signs out an account that no longer belongs to any workspace", async () => {
    const cookie = await signIn(app, "hank@globex.dev");
    await prisma.workspaceMember.deleteMany({ where: { userId: hankId } });

    expect((await asBrowser(app, cookie).get("/api/v2/projects")).status).toBe(401);
  });
});
