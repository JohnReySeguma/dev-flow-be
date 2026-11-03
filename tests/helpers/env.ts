import { loadEnv, type Env } from "../../src/config/env.js";

/**
 * The development environment pointed at the test database, so tests never touch dev data. Email
 * is "not delivered" (console) whatever the developer's .env says, so tests behave the same on
 * every machine and in CI; tests of delivered-email behaviour opt in with EMAIL_PROVIDER: "smtp".
 */
export function testEnv(): Env {
  const env = loadEnv();
  if (!env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required for integration tests (see .env.example).");
  }
  return { ...env, NODE_ENV: "test", DATABASE_URL: env.TEST_DATABASE_URL, EMAIL_PROVIDER: "console" };
}
