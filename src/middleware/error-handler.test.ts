import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import { errorHandler, notFoundHandler } from "./error-handler.js";
import { requestLogger } from "./request-logger.js";

function appThatThrows(error: unknown) {
  const app = express();
  app.use(requestLogger(createLogger({ NODE_ENV: "test" })));
  app.use(express.json({ limit: "1kb" }));
  app.post("/echo", (req, res) => {
    res.json(req.body);
  });
  app.get("/boom", () => {
    throw error;
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  it("renders an AppError as problem+json with its catalogue status", async () => {
    const res = await request(appThatThrows(new AppError("SPRINT_ALREADY_ACTIVE", "Sprint 25 is running.")))
      .get("/boom")
      .set("X-Request-Id", "req-1");

    expect(res.status).toBe(409);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: "urn:devflow:error:SPRINT_ALREADY_ACTIVE",
      title: "Another sprint is already active",
      status: 409,
      detail: "Sprint 25 is running.",
      instance: "/boom",
      code: "SPRINT_ALREADY_ACTIVE",
      requestId: "req-1",
    });
  });

  it("maps a ZodError to 422 with field errors", async () => {
    const zodError = z.object({ title: z.string() }).safeParse({}).error;

    const res = await request(appThatThrows(zodError)).get("/boom");

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.errors).toEqual([{ field: "title", message: expect.any(String) }]);
  });

  it("hides the message of unexpected errors", async () => {
    const res = await request(appThatThrows(new Error("connection string postgres://secret"))).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("reports malformed JSON as 400 BAD_REQUEST", async () => {
    const res = await request(appThatThrows(null)).post("/echo").set("Content-Type", "application/json").send("{");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("reports an oversized body as 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await request(appThatThrows(null))
      .post("/echo")
      .send({ text: "x".repeat(2048) });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("answers unknown routes with 404 NOT_FOUND", async () => {
    const res = await request(appThatThrows(null)).get("/nope");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND", detail: "No route matches GET /nope." });
  });
});
