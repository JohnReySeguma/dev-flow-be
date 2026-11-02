import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLogger } from "../lib/logger.js";
import { errorHandler } from "./error-handler.js";
import { originCheck } from "./origin-check.js";
import { requestLogger } from "./request-logger.js";

const FRONTEND = "http://localhost:3000";
const app = express();
app.use(requestLogger(createLogger({ NODE_ENV: "test" })));
app.use(cookieParser());
app.use(originCheck(FRONTEND));
app.all("/thing", (_req, res) => {
  res.status(204).end();
});
app.use(errorHandler);

const session = "devflow_access=token";

describe("originCheck", () => {
  it("allows safe methods from anywhere", async () => {
    expect((await request(app).get("/thing").set("Origin", "https://evil.example").set("Cookie", session)).status).toBe(
      204,
    );
  });

  it("allows writes from the frontend origin", async () => {
    expect((await request(app).post("/thing").set("Origin", FRONTEND).set("Cookie", session)).status).toBe(204);
  });

  it("blocks writes from another origin", async () => {
    const res = await request(app).delete("/thing").set("Origin", "https://evil.example");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("blocks cookie-authenticated writes without an Origin", async () => {
    expect((await request(app).patch("/thing").set("Cookie", session)).status).toBe(403);
  });

  it("allows writes without an Origin when no session cookie is sent", async () => {
    expect((await request(app).post("/thing")).status).toBe(204);
  });

  it("exempts bearer-token requests", async () => {
    const res = await request(app)
      .post("/thing")
      .set("Origin", "https://evil.example")
      .set("Authorization", "Bearer dfp_x");

    expect(res.status).toBe(204);
  });
});
