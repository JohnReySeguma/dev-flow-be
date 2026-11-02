/**
 * Restores the public demo workspace (Acme Inc): its name, the demo team's memberships and roles,
 * and a fresh copy of the demo projects. Meant for a nightly cron on a public deployment, so
 * whatever visitors changed during the day is gone by morning. See docs/DEPLOYMENT.md.
 *
 *   npm run demo:reset                                       (development)
 *   docker compose exec api node dist/src/jobs/demo-reset.js (the production image)
 */
import { loadEnv } from "../config/env.js";
import { restoreDemoWorkspace } from "../demo/seed.js";
import { createLogger } from "../lib/logger.js";
import { createPrismaClient } from "../lib/prisma.js";

const env = loadEnv();
const logger = createLogger(env);
const prisma = createPrismaClient(env.DATABASE_URL);
try {
  if (!(await restoreDemoWorkspace(prisma, logger))) logger.info("demo reset skipped: no demo workspace");
} finally {
  await prisma.$disconnect();
}
