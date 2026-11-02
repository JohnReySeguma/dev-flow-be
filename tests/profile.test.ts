import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { FRONTEND_ORIGIN, sessionCookieHeader } from "./helpers/cookies.js";
import { truncateAll } from "./helpers/db.js";

const { app, prisma, close } = createTestApp();
afterAll(close);

let cookie = "";
beforeEach(async () => {
  await truncateAll(prisma);
  const res = await request(app)
    .post("/api/v2/auth/signup")
    .set("Origin", FRONTEND_ORIGIN)
    .send({ name: "Ada Lovelace", email: "ada@acme.dev", password: "correct horse battery" });
  cookie = sessionCookieHeader(res);
});

const getMe = () => request(app).get("/api/v2/me").set("Cookie", cookie);
const patchMe = (body: object, ifMatch?: string) => {
  const req = request(app).patch("/api/v2/me").set("Origin", FRONTEND_ORIGIN).set("Cookie", cookie);
  return (ifMatch ? req.set("If-Match", ifMatch) : req).send(body);
};

describe("GET /api/v2/me", () => {
  it("returns the profile with an ETag", async () => {
    const res = await getMe();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Ada Lovelace", handle: "ada", initials: "AL", role: "admin" });
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{20}"$/);
  });

  it("requires a session", async () => {
    expect((await request(app).get("/api/v2/me")).status).toBe(401);
  });
});

describe("PATCH /api/v2/me", () => {
  it("updates the editable fields and returns a new ETag", async () => {
    const before = await getMe();

    const res = await patchMe({
      name: "Ada King",
      gradient: "from-sky-500 to-cyan-500",
      timezone: "Asia/Manila",
      bio: "Analyst.",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Ada King",
      initials: "AK",
      gradient: "from-sky-500 to-cyan-500",
      timezone: "Asia/Manila",
      bio: "Analyst.",
    });
    expect(res.headers.etag).not.toBe(before.headers.etag);
  });

  it("ignores fields that cannot be changed here", async () => {
    const res = await patchMe({ bio: "Hi", role: "viewer", email: "evil@acme.dev" });

    expect(res.body).toMatchObject({ role: "admin", email: "ada@acme.dev", bio: "Hi" });
  });

  it.each([
    [{ timezone: "Mars/Olympus" }, "timezone"],
    [{ gradient: "bg-red-500" }, "gradient"],
    [{ bio: "x".repeat(281) }, "bio"],
    [{ name: "x".repeat(49) }, "name"],
    [{}, "(root)"],
  ])("rejects %j", async (body, field) => {
    const res = await patchMe(body);

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe(field);
  });

  it("applies the change when If-Match is current", async () => {
    const { etag } = (await getMe()).headers;

    expect((await patchMe({ bio: "Fresh" }, etag)).status).toBe(200);
  });

  it("refuses to overwrite a newer change: 412 CONFLICT_STALE", async () => {
    const { etag } = (await getMe()).headers;
    await patchMe({ bio: "Saved in another tab" });

    const res = await patchMe({ bio: "Stale edit" }, etag);

    expect(res.status).toBe(412);
    expect(res.body.code).toBe("CONFLICT_STALE");
    expect((await getMe()).body.bio).toBe("Saved in another tab");
  });
});
