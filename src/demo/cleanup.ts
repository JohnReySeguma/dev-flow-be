import type { Logger } from "../lib/logger.js";
import type { PrismaClient } from "../lib/prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes sample workspaces nobody has used for `ttlDays`: not the demo workspace, one member, no
 * pending invites, and nothing but sample projects (at least one). A public deployment fills up
 * with these, since every sign-up gets one. Accounts are kept. Returns how many were deleted.
 */
export async function deleteInactiveSampleWorkspaces(
  prisma: PrismaClient,
  logger: Logger,
  ttlDays: number,
  now = Date.now(),
): Promise<number> {
  const candidates = await prisma.workspace.findMany({
    where: {
      isDemo: false,
      lastActivityAt: { lt: new Date(now - ttlDays * DAY_MS) },
      invites: { none: {} },
      projects: { some: { isSample: true }, none: { isSample: false } },
    },
    select: { id: true, slug: true, _count: { select: { members: true } } },
  });
  const ids = candidates.filter((w) => w._count.members === 1).map((w) => w.id);
  if (ids.length === 0) return 0;
  const { count } = await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
  logger.info({ deleted: count, ttlDays }, "inactive sample workspaces deleted");
  return count;
}
