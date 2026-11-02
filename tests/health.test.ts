import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/app.js";

const { app, env, close } = createTestApp();
afterAll(close);

describe("GET /api/v2/health", () => {
  it("reports liveness without touching dependencies", async () => {
    const res = await request(app).get("/api/v2/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /api/v2/health/ready", () => {
  it("is ready when the database (and redis, if configured) answer", async () => {
    const res = await request(app).get("/api/v2/health/ready");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      checks: { database: "up", redis: env.REDIS_URL ? "up" : "disabled" },
    });
  });
});

describe("API versions", () => {
  it.each(["/api/v1/health", "/api/v1/config", "/api/v1/auth/me"])("no longer serves %s", async (path) => {
    const res = await request(app).get(path);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
