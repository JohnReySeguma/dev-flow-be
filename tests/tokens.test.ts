import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";

const { app, prisma, close } = createTestApp();
afterAll(close);

async function signUp(email: string) {
  const res = await request(app)
    .post("/api/v1/auth/signup")
    .set("Origin", FRONTEND_ORIGIN)
    .send({ name: "Ada Lovelace", email, password: "correct horse battery" });
  return sessionCookieHeader(res);
}

let cookie = "";
beforeEach(async () => {
  await truncateAll(prisma);
  cookie = await signUp("ada@acme.dev");
});

const createToken = (body: object, as = cookie) =>
  request(app).post("/api/v1/me/tokens").set("Origin", FRONTEND_ORIGIN).set("Cookie", as).send(body);
const cli = { name: "devflow-cli · MacBook Pro", scopes: ["issues:read", "issues:write"], expiresInDays: null };

describe("POST /api/v1/me/tokens", () => {
  it("returns the secret once and stores only its hash", async () => {
    const res = await createToken(cli);

    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^dfp_[\w-]{40}$/);
    expect(res.body.token).toMatchObject({
      name: cli.name,
      scopes: cli.scopes,
      lastFour: res.body.secret.slice(-4),
      lastUsedAt: null,
      expiresAt: null,
    });
    const stored = await prisma.accessToken.findFirstOrThrow();
    expect(JSON.stringify(stored)).not.toContain(res.body.secret);
  });

  it("sets an expiry from expiresInDays and de-duplicates scopes", async () => {
    const res = await createToken({ name: "CI", scopes: ["issues:write", "issues:write"], expiresInDays: 30 });

    expect(res.body.token.scopes).toEqual(["issues:write"]);
    const days = (Date.parse(res.body.token.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it.each([
    [{ ...cli, scopes: [] }, "scopes"],
    [{ ...cli, scopes: ["admin:everything"] }, "scopes.0"],
    [{ ...cli, expiresInDays: 0 }, "expiresInDays"],
    [{ ...cli, name: "" }, "name"],
  ])("rejects %j", async (body, field) => {
    const res = await createToken(body);

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe(field);
  });
});

describe("GET /api/v1/me/tokens", () => {
  it("lists your tokens newest first, without secrets, one page at a time", async () => {
    for (const name of ["first", "second", "third"]) await createToken({ ...cli, name });
    await createToken({ ...cli, name: "someone else's" }, await signUp("grace@acme.dev"));

    const page1 = await request(app).get("/api/v1/me/tokens?limit=2").set("Cookie", cookie);
    const page2 = await request(app)
      .get(`/api/v1/me/tokens?limit=2&cursor=${page1.body.nextCursor}`)
      .set("Cookie", cookie);

    expect(page1.body.items.map((t: { name: string }) => t.name)).toEqual(["third", "second"]);
    expect(page2.body.items.map((t: { name: string }) => t.name)).toEqual(["first"]);
    expect(page2.body.nextCursor).toBeNull();
    expect(JSON.stringify(page1.body)).not.toContain("dfp_");
  });

  it("rejects a malformed cursor", async () => {
    const res = await request(app).get("/api/v1/me/tokens?cursor=garbage").set("Cookie", cookie);

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe("cursor");
  });
});

describe("Bearer authentication", () => {
  const asToken = (secret: string) => ({ Authorization: `Bearer ${secret}` });

  it("authenticates GET /auth/me and GET /me, and records lastUsedAt", async () => {
    const { secret } = (await createToken(cli)).body;

    const me = await request(app).get("/api/v1/auth/me").set(asToken(secret));
    const profile = await request(app).get("/api/v1/me").set(asToken(secret));

    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("ada@acme.dev");
    expect(profile.status).toBe(200);
    expect((await prisma.accessToken.findFirstOrThrow()).lastUsedAt).not.toBeNull();
  });

  it("cannot change the profile or manage tokens", async () => {
    const { secret } = (await createToken(cli)).body;

    const patch = await request(app).patch("/api/v1/me").set(asToken(secret)).send({ bio: "pwned" });
    const mint = await request(app).post("/api/v1/me/tokens").set(asToken(secret)).send(cli);

    expect(patch.status).toBe(403);
    expect(mint.status).toBe(403);
    expect(mint.body.code).toBe("FORBIDDEN");
  });

  it("rejects unknown, malformed, expired and revoked tokens with 401", async () => {
    const { secret, token } = (await createToken(cli)).body;
    const expired = (await createToken({ ...cli, name: "old", expiresInDays: 1 })).body;
    await prisma.accessToken.update({ where: { id: expired.token.id }, data: { expiresAt: new Date(Date.now() - 1) } });

    expect((await request(app).get("/api/v1/me").set(asToken("dfp_unknown"))).status).toBe(401);
    expect((await request(app).get("/api/v1/me").set("Authorization", `Basic ${secret}`)).status).toBe(401);
    expect((await request(app).get("/api/v1/me").set(asToken(expired.secret))).status).toBe(401);

    const revoke = await request(app)
      .delete(`/api/v1/me/tokens/${token.id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", cookie);
    expect(revoke.status).toBe(204);
    expect((await request(app).get("/api/v1/me").set(asToken(secret))).status).toBe(401);
  });

  it("never falls back to the session cookie when an Authorization header is present", async () => {
    const res = await request(app).get("/api/v1/me").set("Cookie", cookie).set(asToken("dfp_invalid"));

    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/v1/me/tokens/:id", () => {
  it("is 404 for someone else's token or a malformed id", async () => {
    const theirs = (await createToken(cli, await signUp("grace@acme.dev"))).body.token.id;
    const del = (id: string) =>
      request(app).delete(`/api/v1/me/tokens/${id}`).set("Origin", FRONTEND_ORIGIN).set("Cookie", cookie);

    expect((await del(theirs)).status).toBe(404);
    expect((await del("not-a-uuid")).status).toBe(404);
    expect(await prisma.accessToken.count()).toBe(1);
  });
});
