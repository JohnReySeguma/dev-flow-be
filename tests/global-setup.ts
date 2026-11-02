import { execSync } from "node:child_process";
import { testEnv } from "./helpers/env.js";

/**
 * Brings the test database up to the latest migration once per run. A failure here is most often
 * the database container not running. Vitest cannot print errors thrown from global setup (it
 * shows "No test files found" and a source-map crash instead), so the reason goes to stderr first.
 */
export default function setup() {
  const { DATABASE_URL } = testEnv();
  try {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL }, stdio: "pipe" });
  } catch (error) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    const detail = output.trim().split("\n").slice(-3).join("\n");
    const message = `Could not migrate the test database. Is it running? Start it with \`npm run db:up\`.\n${detail}`;
    console.error(`\n${message}\n`);
    throw new Error(message, { cause: error });
  }
}
