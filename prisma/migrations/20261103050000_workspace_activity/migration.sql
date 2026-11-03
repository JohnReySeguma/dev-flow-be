-- When a member last used each workspace, for the optional cleanup of untouched sample workspaces.
-- Existing workspaces count as used now, so an upgrade never deletes anything straight away.
ALTER TABLE "workspaces" ADD COLUMN "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
