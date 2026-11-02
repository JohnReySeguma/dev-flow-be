import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { createTestApp } from "./helpers/app.js";
import { testEnv } from "./helpers/env.js";
import { asBrowser, signIn } from "./helpers/session.js";

/** The migration that introduced memberships; everything before it is the v1 schema. */
const MEMBERSHIPS = "20261103010000_workspace_memberships";
const MIGRATIONS = join(import.meta.dirname, "..", "prisma", "migrations");
const SCRATCH_DB = "devflow_migration_check";

const testUrl = new URL(testEnv().DATABASE_URL);
const scratchUrl = Object.assign(new URL(testUrl), { pathname: `/${SCRATCH_DB}` }).toString();

const ids = {
  acme: "0193f1c2-0000-7000-8000-00000000a001",
  demo: "0193f1c2-0000-7000-8000-00000000a002",
  ada: "0193f1c2-0000-7000-8000-00000000b001",
  bob: "0193f1c2-0000-7000-8000-00000000b002",
  token: "0193f1c2-0000-7000-8000-00000000c001",
  invite: "0193f1c2-0000-7000-8000-00000000d001",
  project: "0193f1c2-0000-7000-8000-00000000e001",
  status: "0193f1c2-0000-7000-8000-00000000f001",
};

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const migrationSql = (name: string) => readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8");

/** A database at v1.0.1, holding the kind of data a v1 deployment has, then migrated to memberships. */
beforeAll(async () => {
  await withClient(testUrl.toString(), async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  });
  const migrations = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const v1 = migrations.filter((name) => name < MEMBERSHIPS);
  const later = migrations.filter((name) => name >= MEMBERSHIPS);
  const passwordHash = await hashPassword("correct-horse");

  await withClient(scratchUrl, async (db) => {
    for (const name of v1) await db.query(migrationSql(name));
    // Two workspaces with the same name; the second holds the public demo account.
    await db.query(
      `INSERT INTO workspaces (id, name, created_at, updated_at) VALUES
         ($1, 'Acme Inc', now(), now()), ($2, 'Acme Inc', now() + interval '1 second', now())`,
      [ids.acme, ids.demo],
    );
    await db.query(
      `INSERT INTO users (workspace_id, id, email, name, handle, gradient, role, updated_at)
       VALUES ($1, gen_random_uuid(), 'demo@devflow.local', 'John Rey', 'jrey', 'from-violet-500 to-indigo-600', 'admin', now())`,
      [ids.demo],
    );
    await db.query(
      `INSERT INTO users (id, workspace_id, email, name, handle, gradient, role, password_hash, created_at, updated_at) VALUES
         ($1, $3, 'ada@acme.dev', 'Ada Lovelace', 'ada', 'from-violet-500 to-indigo-600', 'admin', $4, now(), now()),
         ($2, $3, 'bob@acme.dev', 'Bob Byte', 'bob', 'from-sky-500 to-cyan-500', 'viewer', $4, now() + interval '1 second', now())`,
      [ids.ada, ids.bob, ids.acme, passwordHash],
    );
    await db.query(
      `INSERT INTO access_tokens (id, user_id, name, token_hash, last_four, scopes)
       VALUES ($1, $2, 'cli', 'hash-of-cli', 'abcd', '{issues:read}')`,
      [ids.token, ids.ada],
    );
    await db.query(
      `INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, invited_by_id, expires_at, created_at, updated_at)
       VALUES ($1, $2, 'grace@acme.dev', 'member', 'hash-of-invite', $3, now() + interval '7 days', now() + interval '2 seconds', now())`,
      [ids.invite, ids.acme, ids.ada],
    );
    await db.query(
      `INSERT INTO projects (id, workspace_id, key, name, color, lead_id, next_issue_number, updated_at)
       VALUES ($1, $2, 'DEV', 'DevFlow Core', 'from-violet-500 to-indigo-600', $3, 2, now())`,
      [ids.project, ids.acme, ids.ada],
    );
    await db.query(
      `INSERT INTO workflow_statuses (id, project_id, name, category, position) VALUES ($1, $2, 'To Do', 'todo', 0)`,
      [ids.status, ids.project],
    );
    await db.query(
      `INSERT INTO issues (id, project_id, number, status_id, type, priority, title, rank, assignee_id, updated_at)
       VALUES ('0193f1c2-0000-7000-8000-0000000a0001', $1, 1, $2, 'task', 'medium', 'Survives the migration', 'a0', $3, now())`,
      [ids.project, ids.status, ids.bob],
    );
    // The memberships migration and every one after it, as `migrate deploy` would on upgrade.
    for (const name of later) await db.query(migrationSql(name));
  });
}, 60_000);

afterAll(async () => {
  await withClient(testUrl.toString(), (admin) => admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`));
});

describe(`migration ${MEMBERSHIPS}`, () => {
  it("turns each user's workspace and role into a membership", async () => {
    const rows = await withClient(
      scratchUrl,
      async (db) =>
        (
          await db.query(
            `SELECT u.email, m.role, m.workspace_id FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 ORDER BY u.email`,
            [ids.acme],
          )
        ).rows,
    );

    expect(rows).toEqual([
      { email: "ada@acme.dev", role: "admin", workspace_id: ids.acme },
      { email: "bob@acme.dev", role: "viewer", workspace_id: ids.acme },
    ]);
  });

  it("gives each workspace a unique slug, marks the demo one and binds tokens", async () => {
    const [workspaces, token] = await withClient(scratchUrl, async (db) => [
      (await db.query(`SELECT slug, is_demo FROM workspaces ORDER BY created_at`)).rows,
      (await db.query(`SELECT workspace_id FROM access_tokens`)).rows[0],
    ]);

    expect(workspaces).toEqual([
      { slug: "acme-inc", is_demo: false },
      { slug: `acme-inc-${ids.demo.replaceAll("-", "").slice(24, 32)}`, is_demo: true },
    ]);
    expect(token).toEqual({ workspace_id: ids.acme });
  });

  it("flags the demo workspace's demo accounts, and only those", async () => {
    const rows = await withClient(
      scratchUrl,
      async (db) => (await db.query(`SELECT email FROM users WHERE is_demo ORDER BY email`)).rows,
    );

    expect(rows).toEqual([{ email: "demo@devflow.local" }]);
  });

  it("treats existing accounts as verified and drops the old columns", async () => {
    const [verified, columns] = await withClient(scratchUrl, async (db) => [
      (await db.query(`SELECT count(*)::int AS n FROM users WHERE email_verified_at IS NOT NULL`)).rows[0],
      (
        await db.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'users' AND column_name IN ('workspace_id', 'role')`,
        )
      ).rows,
    ]);

    expect(verified).toEqual({ n: 3 });
    expect(columns).toEqual([]);
  });

  it("leaves a database the API works with", async () => {
    const migrated = createTestApp({ env: { DATABASE_URL: scratchUrl } });
    const ada = asBrowser(migrated.app, await signIn(migrated.app, "ada@acme.dev", "correct-horse"));

    const [members, issue] = await Promise.all([
      ada.get("/api/v2/workspaces/acme-inc/members"),
      ada.get("/api/v2/workspaces/acme-inc/issues/DEV-1"),
    ]);

    expect(
      members.body.items.map((m: { email: string; role: string; status: string }) => [m.email, m.role, m.status]),
    ).toEqual([
      ["ada@acme.dev", "admin", "active"],
      ["bob@acme.dev", "viewer", "active"],
      ["grace@acme.dev", "member", "invited"],
    ]);
    expect(issue.body).toMatchObject({ title: "Survives the migration", assigneeId: ids.bob });
    await migrated.close();
  });
});
