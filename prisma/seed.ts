import { pathToFileURL } from "node:url";
import { loadEnv } from "../src/config/env.js";
import { seedDemo } from "../src/demo/seed.js";
import { createLogger, type Logger } from "../src/lib/logger.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";

export { DEMO_MEMBERS, DEMO_PASSWORD, DEMO_WORKSPACE_NAME } from "../src/demo/accounts.js";

/** Seeds the demo workspace into an empty database; see src/demo for the data. */
export const seed = (prisma: PrismaClient, logger: Logger, now?: number, options?: { tracker?: boolean }) =>
  seedDemo(prisma, logger, now, options);

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
