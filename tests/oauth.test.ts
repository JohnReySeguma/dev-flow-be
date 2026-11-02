import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader, setCookies } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";
import { testEnv } from "./helpers/env.js";

/** What the fake GitHub returns for the signed-in account; tests adjust it. */
let githubAccount = { id: 42, login: "ada", name: "Ada Lovelace" as string | null };
let githubEmails = [{ email: "ada@acme.dev", primary: true, verified: true }];

const fakeFetch = ((input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://github.com/login/oauth/access_token"))
    return Promise.resolve(Response.json({ access_token: "gho_test" }));
  if (url.startsWith("https://api.github.com/user/emails")) return Promise.resolve(Response.json(githubEmails));
  if (url.startsWith("https://api.github.com/user")) return Promise.resolve(Response.json(githubAccount));
  return Promise.resolve(new Response("unexpected", { status: 500 }));
}) as typeof fetch;

const { app, prisma, close } = createTestApp({
  env: {
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    API_URL: "http://localhost:4000",
  },
  fetch: fakeFetch,
});
afterAll(close);

beforeEach(async () => {
  await truncateAll(prisma);
  githubAccount = { id: 42, login: "ada", name: "Ada Lovelace" };
  githubEmails = [{ email: "ada@acme.dev", primary: true, verified: true }];
});

/** Runs the redirect to GitHub and the callback, as a browser would. */
async function signInWithGitHub(options: { redirect?: string; state?: string; query?: string } = {}) {
  const start = await request(app).get(
    `/api/v2/auth/oauth/github${options.redirect ? `?redirect=${encodeURIComponent(options.redirect)}` : ""}`,
  );
  const authorize = new URL(String(start.headers.location));
  const stateCookie = setCookies(start).devflow_oauth?.value ?? "";
  const state = options.state ?? authorize.searchParams.get("state") ?? "";
  const callback = await request(app)
    .get(`/api/auth/oauth/github/callback?${options.query ?? `code=abc&state=${state}`}`)
    .set("Cookie", `devflow_oauth=${stateCookie}`);
  return { start, authorize, callback };
}

describe("GET /api/v2/auth/oauth/:provider", () => {
  it("redirects to GitHub with the registered callback, a state and PKCE", async () => {
    const { start, authorize } = await signInWithGitHub();

    expect(start.status).toBe(302);
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://localhost:4000/api/auth/oauth/github/callback");
    expect(authorize.searchParams.get("state")).toMatch(/^[\w-]{20,}$/);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(setCookies(start).devflow_oauth?.attributes).toMatch(/Path=\/api\/auth\/oauth;.*HttpOnly;.*Secure/);
  });

  it("is 404 for a provider that is not configured or does not exist", async () => {
    expect((await request(app).get("/api/v2/auth/oauth/google")).status).toBe(404);
    expect((await request(app).get("/api/v2/auth/oauth/myspace")).status).toBe(404);
    expect((await request(app).get("/api/v2/auth/oauth/constructor")).status).toBe(404);
    expect((await request(app).get("/api/v2/auth/oauth/toString/callback")).status).toBe(404);
  });
});

describe("GET /api/v2/auth/oauth/:provider/callback", () => {
  it("creates the account, signs in and lands on the requested page", async () => {
    const { callback } = await signInWithGitHub({ redirect: "/projects/DEV" });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${FRONTEND_ORIGIN}/projects/DEV`);
    const me = await request(app).get("/api/v2/auth/me").set("Cookie", sessionCookieHeader(callback));
    expect(me.body.user).toMatchObject({ name: "Ada Lovelace", email: "ada@acme.dev" });
    expect(me.body.workspaces).toEqual([expect.objectContaining({ name: "Ada Lovelace's workspace", role: "admin" })]);
    expect(setCookies(callback).devflow_oauth?.value).toBe("");
  });

  it("signs the same GitHub account into the same user next time, even after an email change", async () => {
    await signInWithGitHub();
    githubEmails = [{ email: "ada@new-domain.dev", primary: true, verified: true }];

    await signInWithGitHub();

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.oAuthAccount.count()).toBe(1);
  });

  it("links GitHub to an existing password account with the same verified email", async () => {
    await request(app)
      .post("/api/v2/auth/signup")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ name: "Ada", email: "ada@acme.dev", password: "correct horse battery" });

    const { callback } = await signInWithGitHub();

    expect(callback.headers.location).toBe(`${FRONTEND_ORIGIN}/projects`);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.oAuthAccount.count()).toBe(1);
  });

  it("takes an account back from whoever registered the email first", async () => {
    // Someone signs up with Ada's address (never verified) and keeps a session and a token.
    const signup = await request(app)
      .post("/api/v2/auth/signup")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ name: "Not Ada", email: "ada@acme.dev", password: "attacker password" });
    const squatter = sessionCookieHeader(signup);
    const token = await request(app)
      .post("/api/v2/me/tokens")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", squatter)
      .send({ name: "keep", scopes: ["issues:read"], expiresInDays: null, workspace: signup.body.workspaces[0].slug });

    const { callback } = await signInWithGitHub();

    expect(callback.headers.location).toBe(`${FRONTEND_ORIGIN}/projects`);
    expect((await request(app).get("/api/v2/auth/me").set("Cookie", squatter)).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/v2/auth/me")
          .set("Authorization", `Bearer ${token.body.secret as string}`)
      ).status,
    ).toBe(401);
    const login = await request(app)
      .post("/api/v2/auth/login")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ email: "ada@acme.dev", password: "attacker password" });
    expect(login.status).toBe(401);
    expect((await request(app).get("/api/v2/auth/me").set("Cookie", sessionCookieHeader(callback))).status).toBe(200);
  });

  it("refuses an account without a verified email", async () => {
    githubEmails = [{ email: "ada@acme.dev", primary: true, verified: false }];

    const { callback } = await signInWithGitHub();

    expect(callback.headers.location).toBe(`${FRONTEND_ORIGIN}/login?error=oauth_email_unverified`);
    expect(await prisma.user.count()).toBe(0);
  });

  it("never takes over a demo account, whose password is public", async () => {
    await seed(prisma, createLogger(testEnv()), undefined, { tracker: false });
    githubEmails = [{ email: "aiko@acme.dev", primary: true, verified: true }];
    const before = await prisma.user.findUniqueOrThrow({ where: { email: "aiko@acme.dev" } });

    const { callback } = await signInWithGitHub();

    expect(callback.headers.location).toBe(`${FRONTEND_ORIGIN}/login?error=oauth_account_locked`);
    const after = await prisma.user.findUniqueOrThrow({ where: { email: "aiko@acme.dev" } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await prisma.oAuthAccount.count()).toBe(0);
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const { callback } = await signInWithGitHub({ state: "forged-state" });

    expect(callback.headers.location).toBe(`${FRONTEND_ORIGIN}/login?error=oauth_state_mismatch`);
    expect(callback.headers["set-cookie"]?.toString()).not.toContain("devflow_access=e");
  });

  it("reports a cancelled consent screen", async () => {
    const start = await request(app).get("/api/v2/auth/oauth/github");
    const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";

    const { callback } = await signInWithGitHub({ query: `error=access_denied&state=${state}` });

    expect(callback.headers.location).toMatch(/\/login\?error=oauth_(denied|state_mismatch)$/);
  });

  it("never redirects off-site", async () => {
    const { callback } = await signInWithGitHub({ redirect: "//evil.example/steal" });

    expect(callback.headers.location).toBe(`${FRONTEND_ORIGIN}/projects`);
  });
});
