import { pathToFileURL } from "node:url";
import { loadEnv } from "../src/config/env.js";
import { createLogger, type Logger } from "../src/lib/logger.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";

/** Demo workspace from the frontend (components/settings/settings-view.tsx). */
export const DEMO_WORKSPACE_NAME = "Acme Inc";

/**
 * Seeds the demo data only into an empty database, so it is safe to run on every container
 * start. Returns whether anything was written.
 */
export async function seed(prisma: PrismaClient, logger: Logger): Promise<boolean> {
  if ((await prisma.workspace.count()) > 0) {
    logger.info("seed skipped: database already has data");
    return false;
  }
  await prisma.workspace.create({ data: { name: DEMO_WORKSPACE_NAME } });
  logger.info({ workspace: DEMO_WORKSPACE_NAME }, "seeded demo data");
  return true;
}

async function main() {
  const env = loadEnv();
  const logger = createLogger(env);
  if (!env.SEED_DEMO_DATA) {
    logger.info("seed skipped: SEED_DEMO_DATA is false");
    return;
  }
  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    await seed(prisma, logger);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
