import { execSync } from "node:child_process";
import { testEnv } from "./helpers/env.js";

/** Brings the test database up to the latest migration once per run. */
export default function setup() {
  const { DATABASE_URL } = testEnv();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL }, stdio: "pipe" });
}
