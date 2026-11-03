import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";

const { app, prisma, email, close } = createTestApp();
afterAll(close);

const ada = { name: "Ada Lovelace", email: "ada@acme.dev", password: "correct horse battery" };
const post = (path: string, body: object) =>
  request(app).post(`/api/v2/auth${path}`).set("Origin", FRONTEND_ORIGIN).send(body);

let session = "";
let workspace = "";
beforeEach(async () => {
  await truncateAll(prisma);
  email.sent.length = 0;
  const signup = await post("/signup", ada);
  session = sessionCookieHeader(signup);
  workspace = signup.body.workspaces[0].slug;
  // Sign-up emails a verification link in the background; start each test with an empty outbox.
  await vi.waitFor(() => {
    expect(email.sent).toHaveLength(1);
  });
  email.sent.length = 0;
});

/** Requests a reset and returns the token from the emailed link. */
async function requestResetToken(address = ada.email): Promise<string> {
  const before = email.sent.length;
  expect((await post("/password/forgot", { email: address })).status).toBe(202);
  await vi.waitFor(() => {
    expect(email.sent.length).toBe(before + 1);
  });
  const link = /http\S+reset-password\?token=(\S+)/.exec(email.sent.at(-1)?.text ?? "");
  return decodeURIComponent(link?.[1] ?? "");
}

describe("POST /api/v2/auth/password/forgot", () => {
  it("emails a single-use link to the frontend's reset page", async () => {
    await requestResetToken("ADA@acme.dev");

    const message = email.sent.at(-1);
    expect(message?.to).toBe("ada@acme.dev");
    expect(message?.text).toContain(`${FRONTEND_ORIGIN}/reset-password?token=`);
    expect(message?.text).toContain("expires in 60 minutes");
  });

  it("answers 202 for an unknown email without sending anything", async () => {
    const res = await post("/password/forgot", { email: "nobody@acme.dev" });

    expect(res.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(email.sent).toHaveLength(0);
  });

  it("stores only a hash of the token", async () => {
    const token = await requestResetToken();

    const stored = await prisma.passwordResetToken.findFirstOrThrow();
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("POST /api/v2/auth/password/reset", () => {
  it("sets the new password and signs out every session and access token", async () => {
    const created = await request(app)
      .post("/api/v2/me/tokens")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", session)
      .send({ name: "cli", scopes: ["issues:read"], expiresInDays: null, workspace });
    const bearer = `Bearer ${created.body.secret as string}`;
    expect((await request(app).get("/api/v2/auth/me").set("Authorization", bearer)).status).toBe(200);
    const token = await requestResetToken();

    const res = await post("/password/reset", { token, password: "a brand new password" });

    expect(res.status).toBe(204);
    expect((await request(app).get("/api/v2/auth/me").set("Cookie", session)).status).toBe(401);
    expect((await request(app).get("/api/v2/auth/me").set("Authorization", bearer)).status).toBe(401);
    expect((await post("/login", { email: ada.email, password: ada.password })).status).toBe(401);
    expect((await post("/login", { email: ada.email, password: "a brand new password" })).status).toBe(200);
  });

  it("accepts each link only once", async () => {
    const token = await requestResetToken();
    await post("/password/reset", { token, password: "a brand new password" });

    const again = await post("/password/reset", { token, password: "yet another password" });

    expect(again.status).toBe(400);
    expect(again.body.code).toBe("RESET_TOKEN_INVALID");
  });

  it("only honours the newest link", async () => {
    const older = await requestResetToken();
    await requestResetToken();

    expect((await post("/password/reset", { token: older, password: "a brand new password" })).body.code).toBe(
      "RESET_TOKEN_INVALID",
    );
  });

  it("rejects an expired link", async () => {
    const token = await requestResetToken();
    await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await post("/password/reset", { token, password: "a brand new password" })).body.code).toBe(
      "RESET_TOKEN_INVALID",
    );
  });

  it("rejects an unknown token and a short password", async () => {
    expect((await post("/password/reset", { token: "made-up", password: "long enough pw" })).status).toBe(400);
    expect((await post("/password/reset", { token: "made-up", password: "short" })).status).toBe(422);
  });
});
