import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createTestApp } from "./helpers/app.js";
import { truncateAll } from "./helpers/db.js";
import { asBrowser, signIn } from "./helpers/session.js";

const { app, env, prisma, close } = createTestApp();
afterAll(close);

let member: ReturnType<typeof asBrowser>;
let viewer: ReturnType<typeof asBrowser>;
beforeEach(async () => {
  await truncateAll(prisma);
  await seed(prisma, createLogger(env), undefined, { tracker: false });
  member = asBrowser(app, await signIn(app, "member@devflow.local"));
  viewer = asBrowser(app, await signIn(app, "viewer@devflow.local"));
  await member.post("/api/v1/projects").send({ name: "DevFlow Core", key: "DEV" });
  await member.post("/api/v1/projects/DEV/issues").send({ title: "Discuss me" });
});

describe("issue comments", () => {
  it("adds a comment, attributes it and counts it on the issue", async () => {
    const res = await member.post("/api/v1/issues/DEV-1/comments").send({ body: "  **Ship it**  " });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      issueKey: "DEV-1",
      body: "**Ship it**",
      author: { name: "Dmitri Kovac", initials: "DK", gradient: "from-sky-500 to-cyan-500" },
    });
    expect((await viewer.get("/api/v1/issues/DEV-1")).body.comments).toBe(1);
  });

  it("lists the thread oldest first, page by page", async () => {
    for (const body of ["first", "second", "third"]) await member.post("/api/v1/issues/DEV-1/comments").send({ body });

    const page1 = await viewer.get("/api/v1/issues/DEV-1/comments?limit=2");
    const page2 = await viewer.get(`/api/v1/issues/dev-1/comments?limit=2&cursor=${page1.body.nextCursor}`);

    expect([...page1.body.items, ...page2.body.items].map((c: { body: string }) => c.body)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("keeps comments when their author leaves, without an author", async () => {
    await member.post("/api/v1/issues/DEV-1/comments").send({ body: "orphan" });
    await prisma.user.delete({ where: { email: "member@devflow.local" } });

    const res = await viewer.get("/api/v1/issues/DEV-1/comments");

    expect(res.body.items[0]).toMatchObject({ body: "orphan", author: null });
  });

  it("is read-only for viewers and validates the body", async () => {
    expect((await viewer.post("/api/v1/issues/DEV-1/comments").send({ body: "hi" })).status).toBe(403);
    expect((await member.post("/api/v1/issues/DEV-1/comments").send({ body: "   " })).status).toBe(422);
    expect((await member.post("/api/v1/issues/DEV-9/comments").send({ body: "hi" })).status).toBe(404);
  });
});
