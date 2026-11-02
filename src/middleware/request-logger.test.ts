import { Writable } from "node:stream";
import express from "express";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { redactUrl, requestLogger } from "./request-logger.js";

describe("redactUrl", () => {
  it.each([
    ["/api/v1/invites/abcDEF123-_/accept", "/api/v1/invites/[redacted]/accept"],
    ["/api/v1/invites/abcDEF123", "/api/v1/invites/[redacted]"],
    [
      "/api/v1/auth/oauth/github/callback?code=gh-code&state=s1",
      "/api/v1/auth/oauth/github/callback?code=[redacted]&state=[redacted]",
    ],
    ["/reset?token=t1&x=1", "/reset?token=[redacted]&x=1"],
    ["/api/v1/me/tokens?limit=2", "/api/v1/me/tokens?limit=2"],
  ])("%s → %s", (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });
});

describe("requestLogger", () => {
  it("never writes an invite token to the log", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const app = express();
    app.use(requestLogger(pino({ level: "info" }, sink)));
    app.get("/api/v1/invites/:token", (_req, res) => {
      res.status(204).end();
    });

    await request(app).get("/api/v1/invites/super-secret-token");

    const logged = lines.join("");
    expect(logged).toContain("/api/v1/invites/[redacted]");
    expect(logged).not.toContain("super-secret-token");
  });
});
