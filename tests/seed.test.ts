import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MEMBERS, DEMO_PASSWORD, DEMO_WORKSPACE_NAME, seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";

const { app, env, prisma, close } = createTestApp();
const logger = createLogger(env);

beforeEach(() => truncateAll(prisma));
afterAll(close);

describe("seed", () => {
  it("creates the demo workspace and the frontend's team", async () => {
    expect(await seed(prisma, logger)).toBe(true);

    expect(await prisma.workspace.findMany({ select: { name: true } })).toEqual([{ name: DEMO_WORKSPACE_NAME }]);
    const users = await prisma.user.findMany({ select: { email: true, role: true }, orderBy: { email: "asc" } });
    expect(users).toHaveLength(DEMO_MEMBERS.length);
    expect(users).toEqual(
      expect.arrayContaining([
        { email: "demo@devflow.local", role: "admin" },
        { email: "member@devflow.local", role: "member" },
        { email: "viewer@devflow.local", role: "viewer" },
      ]),
    );
  });

  it.each([
    ["demo@devflow.local", "admin", "John Rey"],
    ["member@devflow.local", "member", "Dmitri Kovac"],
    ["viewer@devflow.local", "viewer", "Lucas Brandt"],
  ])("lets %s sign in as %s", async (email, role, name) => {
    await seed(prisma, logger);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ email, password: DEMO_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role, name });
    expect(res.body.workspace.name).toBe(DEMO_WORKSPACE_NAME);
  });

  it("gives the admin the frontend's example access tokens", async () => {
    await seed(prisma, logger);

    const tokens = await prisma.accessToken.findMany({ select: { lastFour: true } });
    expect(tokens.map((t) => t.lastFour).sort()).toEqual(["Zx02", "q7Rk"].sort());
  });

  it("leaves a database that already has data untouched", async () => {
    await seed(prisma, logger);

    expect(await seed(prisma, logger)).toBe(false);
    expect(await prisma.user.count()).toBe(DEMO_MEMBERS.length);
  });
});
