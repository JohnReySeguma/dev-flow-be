-- The seeded demo accounts, whose password is public. Their profile, access tokens and password
-- reset are locked so visitors cannot take them over or change them for everyone else.
ALTER TABLE "users" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "is_demo" = true
WHERE "email" IN ('demo@devflow.local', 'aiko@acme.dev', 'member@devflow.local', 'priya@acme.dev', 'viewer@devflow.local')
  AND "id" IN (
    SELECT m."user_id" FROM "workspace_members" m JOIN "workspaces" w ON w."id" = m."workspace_id" WHERE w."is_demo"
  );
