import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { resolveFeatures } from "./config/features.js";
import { createLogger } from "./lib/logger.js";
import type { PrismaClient } from "./lib/prisma.js";

const env = parseEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/devflow_test",
  JWT_SECRET: "x".repeat(32),
  CORS_ORIGIN: "http://localhost:3000",
});
// These tests never reach a route that queries; integration tests cover the real database.
const app = createApp({
  env,
  features: resolveFeatures(env),
  logger: createLogger(env),
  prisma: {} as PrismaClient,
  redis: null,
});

describe("createApp", () => {
  it("answers unknown API routes with a problem+json 404", async () => {
    const res = await request(app).get("/api/v1/nope");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("allows credentialed CORS requests from the frontend origin only", async () => {
    const allowed = await request(app).options("/api/v1/nope").set("Origin", "http://localhost:3000");
    const other = await request(app).options("/api/v1/nope").set("Origin", "https://evil.example");

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(other.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
  });

  it("sets security headers and hides the framework", async () => {
    const res = await request(app).get("/api/v1/nope");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
