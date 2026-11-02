import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { publicConfigResponse } from "../src/modules/config/config.schemas.js";
import { createTestApp } from "./helpers/app.js";

const { app, close } = createTestApp();
afterAll(close);

describe("GET /api/v2/config", () => {
  it("returns the feature flags without authentication", async () => {
    const res = await request(app).get("/api/v2/config");

    expect(res.status).toBe(200);
    expect(publicConfigResponse.strict().safeParse(res.body).success).toBe(true);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });
});
