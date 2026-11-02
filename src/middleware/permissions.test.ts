import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLogger } from "../lib/logger.js";
import type { AuthContext } from "../modules/auth/auth.types.js";
import { errorHandler } from "./error-handler.js";
import { hasRole, requireRole, requireScope } from "./permissions.js";
import { requestLogger } from "./request-logger.js";

const workspace = { id: "w", slug: "acme-inc", name: "Acme Inc", isDemo: false };
const caller = { userId: "u", isDemo: false, workspaceId: "w", workspace };
const session = (role: AuthContext["role"]): AuthContext => ({ ...caller, role, via: "session", sessionId: "s" });
const token = (scopes: string[]): AuthContext =>
  ({ ...caller, role: "admin", via: "token", tokenId: "t", scopes, tokenWorkspaceId: "w" }) as AuthContext;

function appWith(auth: AuthContext, guard: RequestHandler) {
  const app = express();
  app.use(requestLogger(createLogger({ NODE_ENV: "test" })));
  app.use((req, _res, next) => {
    req.identity = auth;
    req.auth = auth;
    next();
  });
  app.get("/", guard, (_req, res) => {
    res.status(204).end();
  });
  app.use(errorHandler);
  return app;
}

describe("hasRole", () => {
  it.each([
    ["admin", "member", true],
    ["member", "member", true],
    ["viewer", "member", false],
    ["member", "admin", false],
  ] as const)("%s meets %s: %s", (role, minimum, expected) => {
    expect(hasRole(role, minimum)).toBe(expected);
  });
});

describe("requireRole", () => {
  it("lets a sufficient role through", async () => {
    expect((await request(appWith(session("admin"), requireRole("admin"))).get("/")).status).toBe(204);
  });

  it("answers 403 FORBIDDEN to a lower role", async () => {
    const res = await request(appWith(session("viewer"), requireRole("member"))).get("/");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN", detail: "This action needs the member role." });
  });
});

describe("requireScope", () => {
  it("does not limit signed-in sessions", async () => {
    expect((await request(appWith(session("member"), requireScope("issues:write"))).get("/")).status).toBe(204);
  });

  it("allows a token that has the scope and rejects one that does not", async () => {
    expect((await request(appWith(token(["issues:write"]), requireScope("issues:write"))).get("/")).status).toBe(204);
    expect((await request(appWith(token(["issues:read"]), requireScope("issues:write"))).get("/")).status).toBe(403);
  });
});
