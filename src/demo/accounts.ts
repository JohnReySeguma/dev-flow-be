import type { Prisma, Role } from "../generated/prisma/client.js";
import { randomToken, sha256 } from "../lib/crypto.js";

/** Demo workspace from the frontend (components/settings/settings-view.tsx). */
export const DEMO_WORKSPACE_NAME = "Acme Inc";

/** Shared by every demo account. Seed-only: never set on a database without SEED_DEMO_DATA. */
export const DEMO_PASSWORD = "devflow-demo";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The frontend's member ids (lib/members.ts), used by the tracker data to refer to people. */
export type MemberRef = "u-jr" | "u-am" | "u-dk" | "u-ps" | "u-lb";

type DemoMember = {
  ref: MemberRef;
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
    ref: "u-jr",
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
    ref: "u-am",
    name: "Aiko Mori",
    email: "aiko@acme.dev",
    handle: "aiko",
    gradient: "from-rose-500 to-orange-500",
    role: "admin",
    lastActive: 48 * MINUTE,
  },
  {
    ref: "u-dk",
    name: "Dmitri Kovac",
    email: "member@devflow.local",
    handle: "dkovac",
    gradient: "from-sky-500 to-cyan-500",
    role: "member",
    lastActive: 10 * HOUR + 20 * MINUTE,
  },
  {
    ref: "u-ps",
    name: "Priya Shah",
    email: "priya@acme.dev",
    handle: "priya",
    gradient: "from-emerald-500 to-teal-600",
    role: "member",
    lastActive: 90 * MINUTE,
  },
  {
    ref: "u-lb",
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

/** Creates the workspace, the team and the example tokens. Returns the ids the tracker data needs. */
export async function seedAccounts(
  tx: Prisma.TransactionClient,
  passwordHash: string,
  now: number,
): Promise<{ workspaceId: string; users: Record<MemberRef, string> }> {
  const at = (msAgo: number) => new Date(now - msAgo);
  const workspace = await tx.workspace.create({ data: { name: DEMO_WORKSPACE_NAME } });

  const users = {} as Record<MemberRef, string>;
  for (const { ref, lastActive, ...member } of DEMO_MEMBERS) {
    const user = await tx.user.create({
      data: { ...member, workspaceId: workspace.id, passwordHash, lastActiveAt: at(lastActive) },
    });
    users[ref] = user.id;
  }

  for (const token of DEMO_TOKENS) {
    await tx.accessToken.create({
      data: {
        userId: users["u-jr"],
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
  return { workspaceId: workspace.id, users };
}
