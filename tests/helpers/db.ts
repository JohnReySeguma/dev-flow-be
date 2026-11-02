import type { PrismaClient } from "../../src/lib/prisma.js";

/**
 * Empties the database between tests; the schema and migration history stay. Every table
 * cascades from workspaces, and deleting the few rows a test creates is much faster than
 * TRUNCATE, which takes exclusive locks and resets table storage.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "workspaces"`;
}

/** Tables that still hold rows; empty when every table cascades from workspaces as intended. */
export async function nonEmptyTables(prisma: PrismaClient): Promise<string[]> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const nonEmpty: string[] = [];
  for (const { tablename } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "public"."${tablename}"`);
    if (row && row.n > 0n) nonEmpty.push(tablename);
  }
  return nonEmpty;
}
