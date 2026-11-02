import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedTeam } from "./helpers/team.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
afterAll(close);

let admin: ReturnType<typeof asBrowser>;
let member: ReturnType<typeof asBrowser>;
let viewer: ReturnType<typeof asBrowser>;
beforeEach(async () => {
  await truncateAll(prisma);
  await seedTeam(prisma, createLogger(env), undefined, { tracker: false });
  admin = asBrowser(app, await signIn(app, "demo@devflow.local"));
  member = asBrowser(app, await signIn(app, "member@devflow.local"));
  viewer = asBrowser(app, await signIn(app, "viewer@devflow.local"));
});

const mobile = { name: "Mobile App", key: "mob", description: "React Native client." };

describe("POST /api/v2/workspaces/acme-inc/projects", () => {
  it("creates the project with the default workflow, led by its creator", async () => {
    const res = await member.post("/api/v2/workspaces/acme-inc/projects").send(mobile);

    expect(res.status).toBe(201);
    expect(res.headers.etag).toBeDefined();
    const dmitri = await prisma.user.findUniqueOrThrow({ where: { email: "member@devflow.local" } });
    expect(res.body).toMatchObject({
      key: "MOB",
      name: "Mobile App",
      description: "React Native client.",
      color: "from-sky-500 to-cyan-500",
      leadId: dmitri.id,
      nextIssueNumber: 1,
    });
    expect(res.body.workflow.map((s: { name: string; category: string }) => [s.name, s.category])).toEqual([
      ["To Do", "todo"],
      ["In Progress", "in_progress"],
      ["In Review", "in_progress"],
      ["Done", "done"],
    ]);
  });

  it("gives each new project the next colour", async () => {
    await member.post("/api/v2/workspaces/acme-inc/projects").send(mobile);

    const second = await member.post("/api/v2/workspaces/acme-inc/projects").send({ name: "Billing", key: "BIL" });

    expect(second.body.color).toBe("from-amber-500 to-yellow-600");
  });

  it("rejects a key already in use, whatever its case", async () => {
    await member.post("/api/v2/workspaces/acme-inc/projects").send(mobile);

    const res = await member.post("/api/v2/workspaces/acme-inc/projects").send({ ...mobile, key: "MOB" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROJECT_KEY_TAKEN");
  });

  it.each([["M"], ["MOBILE"], ["MO1"], ["MÖB"]])("rejects the key %j", async (key) => {
    const res = await member.post("/api/v2/workspaces/acme-inc/projects").send({ ...mobile, key });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe("key");
  });

  it("is not allowed for viewers", async () => {
    expect((await viewer.post("/api/v2/workspaces/acme-inc/projects").send(mobile)).status).toBe(403);
  });
});

describe("reading projects", () => {
  beforeEach(async () => {
    await member.post("/api/v2/workspaces/acme-inc/projects").send(mobile);
  });

  it("lists projects for every role", async () => {
    const res = await viewer.get("/api/v2/workspaces/acme-inc/projects");

    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { key: string }) => p.key)).toEqual(["MOB"]);
  });

  it("finds a project by key in any case", async () => {
    const res = await viewer.get("/api/v2/workspaces/acme-inc/projects/mob");

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("MOB");
  });

  it("is 404 for an unknown or malformed key", async () => {
    expect((await viewer.get("/api/v2/workspaces/acme-inc/projects/NOPE")).status).toBe(404);
    expect((await viewer.get("/api/v2/workspaces/acme-inc/projects/not-a-key")).status).toBe(404);
  });
});

describe("PATCH /api/v2/workspaces/acme-inc/projects/:key", () => {
  beforeEach(async () => {
    await member.post("/api/v2/workspaces/acme-inc/projects").send(mobile);
  });

  it("renames and describes the project but never changes its key", async () => {
    const res = await member
      .patch("/api/v2/workspaces/acme-inc/projects/MOB")
      .send({ name: "Mobile", description: "", key: "APP" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: "MOB", name: "Mobile", description: "" });
  });

  it("answers 412 CONFLICT_STALE to an outdated If-Match", async () => {
    const { etag } = (await member.get("/api/v2/workspaces/acme-inc/projects/MOB")).headers;
    await admin.patch("/api/v2/workspaces/acme-inc/projects/MOB").send({ name: "Renamed elsewhere" });

    const res = await member
      .patch("/api/v2/workspaces/acme-inc/projects/MOB")
      .set("If-Match", String(etag))
      .send({ name: "Stale" });

    expect(res.status).toBe(412);
    expect(res.body.code).toBe("CONFLICT_STALE");
  });
});

describe("DELETE /api/v2/workspaces/acme-inc/projects/:key", () => {
  beforeEach(async () => {
    await member.post("/api/v2/workspaces/acme-inc/projects").send(mobile);
  });

  it("is admin-only and removes the workflow too", async () => {
    expect((await member.delete("/api/v2/workspaces/acme-inc/projects/MOB")).status).toBe(403);

    expect((await admin.delete("/api/v2/workspaces/acme-inc/projects/MOB")).status).toBe(204);
    expect(await prisma.workflowStatus.count()).toBe(0);
  });
});

describe("access token scopes", () => {
  async function tokenWith(scopes: string[]) {
    const res = await admin
      .post("/api/v2/me/tokens")
      .send({ name: "cli", scopes, expiresInDays: null, workspace: "acme-inc" });
    return { Authorization: `Bearer ${res.body.secret as string}` };
  }

  it("needs issues:read to read and projects:admin to create", async () => {
    const reader = await tokenWith(["issues:read"]);
    const manager = await tokenWith(["projects:admin"]);

    expect((await request(app).get("/api/v2/workspaces/acme-inc/projects").set(reader)).status).toBe(200);
    expect((await request(app).get("/api/v2/workspaces/acme-inc/projects").set(manager)).status).toBe(403);
    expect((await request(app).post("/api/v2/workspaces/acme-inc/projects").set(reader).send(mobile)).status).toBe(403);
    expect((await request(app).post("/api/v2/workspaces/acme-inc/projects").set(manager).send(mobile)).status).toBe(
      201,
    );
  });

  it("rejects writes from another site", async () => {
    const res = await request(app)
      .post("/api/v2/workspaces/acme-inc/projects")
      .set("Origin", "https://evil.example")
      .send(mobile);

    expect(res.status).toBe(403);
  });
});
