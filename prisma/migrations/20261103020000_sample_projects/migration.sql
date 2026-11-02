-- Projects copied from the sample data, so resetting a workspace's sample data replaces only
-- those and keeps the projects people created themselves.
ALTER TABLE "projects" ADD COLUMN "is_sample" BOOLEAN NOT NULL DEFAULT false;

UPDATE "projects" SET "is_sample" = true
WHERE "key" IN ('DEV', 'BIL', 'MOB')
  AND "workspace_id" IN (SELECT "id" FROM "workspaces" WHERE "is_demo");
