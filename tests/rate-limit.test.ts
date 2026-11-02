import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";

const MINUTE = 60_000;
const { app, env, prisma, close } = createTestApp({
  rateLimits: {
    login: { windowMs: MINUTE, limit: 2 },
    auth: { windowMs: MINUTE, limit: 10 },
    inviteTokens: { windowMs: MINUTE, limit: 2 },
  },
});
afterAll(close);

/** Counters live in Redis when it is configured: start every test from zero. */
async function clearCounters() {
  const { createRedisClient } = await import("../src/lib/redis.js");
  const client = createRedisClient(env.REDIS_URL, createLogger(env));
  if (!client) return;
  const keys = await client.keys("devflow:test:rl:*");
  if (keys.length > 0) await client.del(...keys);
  client.disconnect();
}

const login = (password: string, email = "member@devflow.local") =>
  request(app).post("/api/v2/auth/login").set("Origin", FRONTEND_ORIGIN).send({ email, password });

beforeEach(async () => {
  await clearCounters();
  await truncateAll(prisma);
  await seed(prisma, createLogger(env), undefined, { tracker: false });
});

describe("rate limits", () => {
  it("refuses sign-ins after repeated failures for one account, with Retry-After", async () => {
    expect((await login("wrong-1")).status).toBe(401);
    expect((await login("wrong-2")).status).toBe(401);
    const limited = await login("devflow-demo");

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers.ratelimit).toBeDefined();
  });

  it("counts failures per account, not successes, so others can still sign in", async () => {
    for (let i = 0; i < 3; i++) expect((await login("devflow-demo")).status).toBe(200);
    await login("wrong-1", "viewer@devflow.local");
    await login("wrong-2", "viewer@devflow.local");

    expect((await login("devflow-demo", "viewer@devflow.local")).status).toBe(429);
    expect((await login("devflow-demo", "demo@devflow.local")).status).toBe(200);
  });

  it("caps invite token guesses", async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await request(app).get(`/api/v2/invites/guess-${i}`)).status);

    expect(statuses).toEqual([400, 400, 429]);
  });

  it("limits every API request per client, but never health checks", async () => {
    const tight = createTestApp({ rateLimits: { api: { windowMs: MINUTE, limit: 2 } } });
    const config = [];
    for (let i = 0; i < 3; i++) config.push((await request(tight.app).get("/api/v2/config")).status);
    const health = await request(tight.app).get("/api/v2/health");
    await tight.close();

    expect(config).toEqual([200, 200, 429]);
    expect(health.status).toBe(200);
  });
});
