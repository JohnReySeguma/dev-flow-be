import type { Express } from "express";
import request from "supertest";
import { DEMO_PASSWORD } from "../../prisma/seed.js";
import { FRONTEND_ORIGIN, sessionCookieHeader } from "./cookies.js";

/** Signs in and returns the Cookie header for later requests. Throws if sign-in fails. */
export async function signIn(app: Express, email: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").set("Origin", FRONTEND_ORIGIN).send({ email, password });
  if (res.status !== 200) throw new Error(`sign-in as ${email} failed with ${res.status}`);
  return sessionCookieHeader(res);
}

/** A request builder for writes from the frontend, signed in with `cookie`. */
export function asBrowser(app: Express, cookie: string) {
  const agent = request(app);
  return {
    get: (path: string) => agent.get(path).set("Cookie", cookie),
    post: (path: string) => agent.post(path).set("Origin", FRONTEND_ORIGIN).set("Cookie", cookie),
    patch: (path: string) => agent.patch(path).set("Origin", FRONTEND_ORIGIN).set("Cookie", cookie),
    delete: (path: string) => agent.delete(path).set("Origin", FRONTEND_ORIGIN).set("Cookie", cookie),
  };
}
