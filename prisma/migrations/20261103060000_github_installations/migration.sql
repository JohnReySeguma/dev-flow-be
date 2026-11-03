-- GitHub App installations linked to a workspace. Deliveries from an installation change issues in
-- that workspace only; until one is linked, deliveries change nothing.
CREATE TABLE "github_installations" (
    "installation_id" BIGINT NOT NULL,
    "workspace_id" UUID NOT NULL,
    "account_login" TEXT NOT NULL,
    "linked_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("installation_id")
);

CREATE INDEX "github_installations_workspace_id_idx" ON "github_installations"("workspace_id");
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_linked_by_id_fkey" FOREIGN KEY ("linked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
