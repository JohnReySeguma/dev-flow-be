/**
 * Deletes sample workspaces nobody has used for SAMPLE_WORKSPACE_TTL_DAYS days (one member, no
 * invites, only sample projects). Does nothing while the variable is unset. Meant for a daily
 * cron on a public deployment, where every sign-up creates one. See docs/DEPLOYMENT.md.
 *
 *   npm run cleanup:workspaces                                       (development)
 *   docker compose exec api node dist/src/jobs/cleanup-workspaces.js (the production image)
 */
import { loadEnv } from "../config/env.js";
import { deleteInactiveSampleWorkspaces } from "../demo/cleanup.js";
import { createLogger } from "../lib/logger.js";
import { createPrismaClient } from "../lib/prisma.js";

const env = loadEnv();
const logger = createLogger(env);
if (env.SAMPLE_WORKSPACE_TTL_DAYS === undefined) {
  logger.info("workspace cleanup skipped: SAMPLE_WORKSPACE_TTL_DAYS is not set");
} else {
  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    const deleted = await deleteInactiveSampleWorkspaces(prisma, logger, env.SAMPLE_WORKSPACE_TTL_DAYS);
    if (deleted === 0) logger.info("workspace cleanup: nothing to delete");
  } finally {
    await prisma.$disconnect();
  }
}
