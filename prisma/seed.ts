import { pathToFileURL } from "node:url";
import { loadEnv } from "../src/config/env.js";
import type { Role } from "../src/generated/prisma/client.js";
import { randomToken, sha256 } from "../src/lib/crypto.js";
import { createLogger, type Logger } from "../src/lib/logger.js";
import { hashPassword } from "../src/lib/password.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";

/** Demo workspace from the frontend (components/settings/settings-view.tsx). */
export const DEMO_WORKSPACE_NAME = "Acme Inc";

/** Shared by every demo account. Seed-only: never set on a database without SEED_DEMO_DATA. */
export const DEMO_PASSWORD = "devflow-demo";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type DemoMember = {
  name: string;
  email: string;
  handle: string;
  gradient: string;
  role: Role;
  timezone?: string;
  bio?: string;
  /** How long ago they were last active. */
  lastActive: number;
};

/**
 * The frontend's team (lib/account-data.ts TEAM and SESSION_USER). The handoff's sign-in
 * accounts replace the emails of one person per role.
 */
export const DEMO_MEMBERS: DemoMember[] = [
  {
    name: "John Rey",
    email: "demo@devflow.local",
    handle: "jrey",
    gradient: "from-violet-500 to-indigo-600",
    role: "admin",
    timezone: "America/New_York",
    bio: "Frontend platform lead. Owns the board, realtime sync and the design system.",
    lastActive: 5 * MINUTE,
  },
  {
    name: "Aiko Mori",
    email: "aiko@acme.dev",
    handle: "aiko",
    gradient: "from-rose-500 to-orange-500",
    role: "admin",
    lastActive: 48 * MINUTE,
  },
  {
    name: "Dmitri Kovac",
    email: "member@devflow.local",
    handle: "dkovac",
    gradient: "from-sky-500 to-cyan-500",
    role: "member",
    lastActive: 10 * HOUR + 20 * MINUTE,
  },
  {
    name: "Priya Shah",
    email: "priya@acme.dev",
    handle: "priya",
    gradient: "from-emerald-500 to-teal-600",
    role: "member",
    lastActive: 90 * MINUTE,
  },
  {
    name: "Lucas Brandt",
    email: "viewer@devflow.local",
    handle: "lbrandt",
    gradient: "from-amber-500 to-yellow-600",
    role: "viewer",
    lastActive: 4 * DAY + 17 * HOUR,
  },
];

/**
 * The frontend's example tokens (lib/account-data.ts ACCESS_TOKENS), owned by the admin demo
 * account. Their secrets were never shown to anyone, so they cannot be used.
 */
const DEMO_TOKENS = [
  {
    name: "devflow-cli · MacBook Pro",
    lastFour: "q7Rk",
    scopes: ["issues:read", "issues:write"],
    created: 80 * DAY,
    lastUsed: 19 * MINUTE,
    expiresIn: null,
  },
  {
    name: "GitHub Actions · release.yml",
    lastFour: "Zx02",
    scopes: ["issues:write", "webhooks:manage"],
    created: 152 * DAY,
    lastUsed: 2 * DAY + 15 * HOUR,
    expiresIn: 30 * DAY,
  },
];

/**
 * Seeds the demo data only into an empty database, so it is safe to run on every container
 * start. Every date is relative to `now`. Returns whether anything was written.
 */
export async function seed(prisma: PrismaClient, logger: Logger, now = Date.now()): Promise<boolean> {
  if ((await prisma.workspace.count()) > 0) {
    logger.info("seed skipped: database already has data");
    return false;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const at = (msAgo: number) => new Date(now - msAgo);

  await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({ data: { name: DEMO_WORKSPACE_NAME } });
    for (const { lastActive, ...member } of DEMO_MEMBERS) {
      await tx.user.create({
        data: { ...member, workspaceId: workspace.id, passwordHash, lastActiveAt: at(lastActive) },
      });
    }
    const admin = await tx.user.findUniqueOrThrow({ where: { email: "demo@devflow.local" } });
    for (const token of DEMO_TOKENS) {
      await tx.accessToken.create({
        data: {
          userId: admin.id,
          name: token.name,
          tokenHash: sha256(randomToken()),
          lastFour: token.lastFour,
          scopes: token.scopes,
          createdAt: at(token.created),
          lastUsedAt: at(token.lastUsed),
          expiresAt: token.expiresIn === null ? null : new Date(now + token.expiresIn),
        },
      });
    }
  });

  logger.info({ workspace: DEMO_WORKSPACE_NAME, members: DEMO_MEMBERS.length }, "seeded demo data");
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
