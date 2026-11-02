-- Multiple workspaces (API v2). Moves each user's workspace and role onto a membership, gives
-- workspaces a URL slug, binds access tokens to the workspace they were used in, and records
-- email verification. Existing data becomes members of the workspace it already belonged to.

-- Workspaces: a slug from the name ("Acme Inc" → "acme-inc"), suffixed with part of the id when
-- two names produce the same slug.
ALTER TABLE "workspaces" ADD COLUMN "slug" TEXT;
ALTER TABLE "workspaces" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

WITH base AS (
    SELECT "id",
           COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'workspace') AS "slug",
           row_number() OVER (
               PARTITION BY COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'workspace')
               ORDER BY "created_at", "id"
           ) AS "n"
    FROM "workspaces"
)
UPDATE "workspaces" AS w
SET "slug" = CASE WHEN base."n" = 1 THEN base."slug" ELSE base."slug" || '-' || substr(replace(w."id"::text, '-', ''), 25, 8) END
FROM base
WHERE base."id" = w."id";

ALTER TABLE "workspaces" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- Memberships: one per user, with the role they have today.
CREATE TABLE "workspace_members" (
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id","user_id")
);

INSERT INTO "workspace_members" ("workspace_id", "user_id", "role", "created_at")
SELECT "workspace_id", "id", "role", "created_at" FROM "users";

CREATE INDEX "workspace_members_workspace_id_created_at_user_id_idx" ON "workspace_members"("workspace_id", "created_at", "user_id");
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The seeded demo workspace is the one the public demo admin belongs to.
UPDATE "workspaces" SET "is_demo" = true
WHERE "id" IN (SELECT "workspace_id" FROM "users" WHERE "email" = 'demo@devflow.local');

-- Access tokens work in the workspace their owner was in.
ALTER TABLE "access_tokens" ADD COLUMN "workspace_id" UUID;
UPDATE "access_tokens" AS t SET "workspace_id" = u."workspace_id" FROM "users" AS u WHERE u."id" = t."user_id";
ALTER TABLE "access_tokens" ALTER COLUMN "workspace_id" SET NOT NULL;
CREATE INDEX "access_tokens_workspace_id_idx" ON "access_tokens"("workspace_id");
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Email verification. v1 never asked anyone to verify, so existing accounts are treated as verified.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ(3);
UPDATE "users" SET "email_verified_at" = CURRENT_TIMESTAMP;

-- Users no longer belong to one workspace.
ALTER TABLE "users" DROP CONSTRAINT "users_workspace_id_fkey";
DROP INDEX "users_workspace_id_idx";
ALTER TABLE "users" DROP COLUMN "workspace_id";
ALTER TABLE "users" DROP COLUMN "role";
