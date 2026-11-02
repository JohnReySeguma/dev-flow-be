import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger } from "../lib/logger.js";
import { errorHandler } from "./error-handler.js";
import { requestLogger } from "./request-logger.js";
import { validate } from "./validate.js";

const app = express();
app.use(requestLogger(createLogger({ NODE_ENV: "test" })));
app.use(express.json());
app.post(
  "/projects/:key/issues",
  validate({
    params: z.object({ key: z.string().regex(/^[A-Z]{2,5}$/) }),
    query: z.object({ limit: z.coerce.number().int().max(100).default(50) }),
    body: z.object({ title: z.string().min(1), estimate: z.number().nullable() }),
  }),
  (req, res) => {
    res.json({ params: req.params, query: req.query, body: req.body as unknown });
  },
);
app.use(errorHandler);

describe("validate", () => {
  it("passes parsed and coerced input to the handler", async () => {
    const res = await request(app).post("/projects/DEV/issues?limit=10").send({ title: "Fix", estimate: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      params: { key: "DEV" },
      query: { limit: 10 },
      body: { title: "Fix", estimate: null },
    });
  });

  it("applies schema defaults", async () => {
    const res = await request(app).post("/projects/DEV/issues").send({ title: "Fix", estimate: 3 });

    expect(res.body.query).toEqual({ limit: 50 });
  });

  it("reports every invalid field in one 422 response", async () => {
    const res = await request(app).post("/projects/dev/issues?limit=500").send({ title: "" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(["key", "limit", "title", "estimate"]);
  });
});
