import { loadEnv, type Env } from "../../src/config/env.js";

/** The development environment pointed at the test database, so tests never touch dev data. */
export function testEnv(): Env {
  const env = loadEnv();
  if (!env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required for integration tests (see .env.example).");
  }
  return { ...env, NODE_ENV: "test", DATABASE_URL: env.TEST_DATABASE_URL };
}
