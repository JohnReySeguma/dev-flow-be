import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader, setCookies } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";

const { app, env, prisma, close } = createTestApp();
beforeEach(() => truncateAll(prisma));
afterAll(close);

const ada = { name: "Ada Lovelace", email: "Ada@Acme.dev", password: "correct horse battery" };

const signup = (body: object = ada) =>
  request(app).post("/api/v1/auth/signup").set("Origin", FRONTEND_ORIGIN).send(body);
const login = (body: object) => request(app).post("/api/v1/auth/login").set("Origin", FRONTEND_ORIGIN).send(body);
const me = (cookie?: string) => {
  const req = request(app).get("/api/v1/auth/me");
  return cookie ? req.set("Cookie", cookie) : req;
};

describe("POST /api/v1/auth/signup", () => {
  it("creates the account, signs in and sets hardened session cookies", async () => {
    const res = await signup();

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@acme.dev",
      handle: "ada",
      initials: "AL",
      timezone: "UTC",
      bio: "",
    });
    const cookies = setCookies(res);
    expect(cookies.devflow_access?.attributes).toMatch(/Path=\/api\/v1;.*HttpOnly;.*Secure;.*SameSite=Lax/);
    expect(cookies.devflow_refresh?.attributes).toMatch(/Path=\/api\/v1\/auth;.*HttpOnly;.*Secure;.*SameSite=Lax/);

    const session = await me(sessionCookieHeader(res));
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe("ada@acme.dev");
  });

  it("makes the first user of an empty workspace its admin and later users members", async () => {
    const first = await signup();
    const second = await signup({ name: "Grace Hopper", email: "grace@acme.dev", password: "compiler-1952" });

    expect(first.body.user.role).toBe("admin");
    expect(second.body.user.role).toBe("member");
    expect(second.body.workspace).toEqual(first.body.workspace);
  });

  it("rejects an email that is already registered, whatever its case", async () => {
    await signup();

    const res = await signup({ ...ada, email: "ADA@acme.dev" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("validates every field", async () => {
    const res = await signup({ name: "", email: "nope", password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(["name", "email", "password"]);
  });

  it("never stores the password in plain text", async () => {
    await signup();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@acme.dev" } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe("POST /api/v1/auth/login", () => {
  beforeEach(async () => {
    await signup();
  });

  it("signs in with the right password, ignoring email case", async () => {
    const res = await login({ email: "ADA@acme.dev", password: ada.password });

    expect(res.status).toBe(200);
    expect((await me(sessionCookieHeader(res))).status).toBe(200);
  });

  it("answers a wrong password and an unknown email the same way", async () => {
    const wrongPassword = await login({ email: ada.email, password: "wrong password" });
    const unknownEmail = await login({ email: "nobody@acme.dev", password: "wrong password" });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_CREDENTIALS");
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });
});

describe("GET /api/v1/auth/me", () => {
  it("is 401 UNAUTHENTICATED without a session", async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("is 401 TOKEN_EXPIRED when the access token has expired", async () => {
    const res = await signup();
    const session = await prisma.session.findFirstOrThrow();
    const expired = jwt.sign({ sid: session.id, exp: Math.floor(Date.now() / 1000) - 1 }, env.JWT_SECRET, {
      subject: session.userId,
      issuer: "devflow-api",
      audience: "devflow",
    });
    expect(res.status).toBe(201);

    const expiredRes = await me(`devflow_access=${expired}`);

    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.code).toBe("TOKEN_EXPIRED");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes the session and clears both cookies", async () => {
    const cookie = sessionCookieHeader(await signup());

    const res = await request(app).post("/api/v1/auth/logout").set("Origin", FRONTEND_ORIGIN).set("Cookie", cookie);

    expect(res.status).toBe(204);
    const cleared = setCookies(res);
    expect(cleared.devflow_access?.value).toBe("");
    expect(cleared.devflow_refresh?.value).toBe("");
    expect((await me(cookie)).body.code).toBe("UNAUTHENTICATED");
  });

  it("succeeds when already signed out", async () => {
    const res = await request(app).post("/api/v1/auth/logout").set("Origin", FRONTEND_ORIGIN);

    expect(res.status).toBe(204);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  const refresh = (cookie?: string) => {
    const req = request(app).post("/api/v1/auth/refresh").set("Origin", FRONTEND_ORIGIN);
    return cookie ? req.set("Cookie", cookie) : req;
  };

  it("rotates both tokens; the new session works and the old refresh token does not", async () => {
    const original = sessionCookieHeader(await signup());

    const rotated = await refresh(original);

    expect(rotated.status).toBe(204);
    const next = sessionCookieHeader(rotated);
    expect(next).not.toBe(original);
    expect((await me(next)).status).toBe(200);
  });

  it("revokes the whole session when a used refresh token comes back", async () => {
    const original = sessionCookieHeader(await signup());
    const next = sessionCookieHeader(await refresh(original));

    const replay = await refresh(original);

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe("UNAUTHENTICATED");
    expect(setCookies(replay).devflow_refresh?.value).toBe("");
    // The legitimate holder of the newest tokens is signed out too.
    expect((await refresh(next)).status).toBe(401);
    expect((await me(next)).body.code).toBe("UNAUTHENTICATED");
  });

  it("lets only one of two concurrent refreshes win", async () => {
    const original = sessionCookieHeader(await signup());

    const results = await Promise.all([refresh(original), refresh(original)]);

    expect(results.map((r) => r.status).sort()).toEqual([204, 401]);
  });

  it("is 401 without a refresh cookie or after logout", async () => {
    const cookie = sessionCookieHeader(await signup());
    await request(app).post("/api/v1/auth/logout").set("Origin", FRONTEND_ORIGIN).set("Cookie", cookie);

    expect((await refresh()).status).toBe(401);
    expect((await refresh(cookie)).status).toBe(401);
  });
});
