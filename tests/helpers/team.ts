import { seed } from "../../prisma/seed.js";
import type { Logger } from "../../src/lib/logger.js";
import type { PrismaClient } from "../../src/lib/prisma.js";

/**
 * The demo data as an ordinary team workspace: Acme Inc and its people without the demo locks,
 * for tests of admin and account features that are turned off in the public demo.
 */
export async function seedTeam(
  prisma: PrismaClient,
  logger: Logger,
  now?: number,
  options?: { tracker?: boolean },
): Promise<boolean> {
  const seeded = await seed(prisma, logger, now, options);
  await prisma.workspace.updateMany({ where: { isDemo: true }, data: { isDemo: false } });
  await prisma.user.updateMany({ where: { isDemo: true }, data: { isDemo: false } });
  return seeded;
}
