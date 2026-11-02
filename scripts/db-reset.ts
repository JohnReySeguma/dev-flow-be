/**
 * Drops and recreates the development and test databases, applies every migration and seeds
 * the development database. Destroys all local data: development use only.
 */
import { execSync } from "node:child_process";
import { loadEnv } from "../src/config/env.js";

const env = loadEnv();

function run(command: string, databaseUrl: string) {
  execSync(command, { stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl } });
}

run("npx prisma migrate reset --force", env.DATABASE_URL);
run("npx prisma db seed", env.DATABASE_URL);
if (env.TEST_DATABASE_URL) run("npx prisma migrate reset --force", env.TEST_DATABASE_URL);
