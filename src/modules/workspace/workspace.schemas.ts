import { z } from "zod";
import { pageOf } from "../../lib/pagination.js";
import { roleSchema } from "../users/users.schemas.js";

export const workspaceResponse = z
  .object({
    id: z.uuid(),
    slug: z
      .string()
      .meta({ description: "Used in URLs: /workspaces/{slug}/…. Set at creation, unchanged by renames." }),
    name: z.string(),
    role: roleSchema.meta({ description: "The signed-in user's role in this workspace." }),
    isDemo: z.boolean().meta({
      description: "The public demo workspace: renaming, deleting, leaving, invites and member changes are locked.",
    }),
  })
  .meta({
    id: "Workspace",
    example: {
      id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e00",
      slug: "acme-inc",
      name: "Acme Inc",
      role: "admin",
      isDemo: true,
    },
  });

export const workspacePage = pageOf(workspaceResponse).meta({
  id: "WorkspacePage",
  example: { items: [workspaceResponse.meta()?.example], nextCursor: null },
});

const workspaceName = z.string().trim().min(1, "Name the workspace.").max(48, "Use at most 48 characters.");

export const createWorkspaceBody = z
  .object({
    name: workspaceName,
    sampleData: z
      .boolean()
      .default(true)
      .meta({ description: "Copy the sample projects (DEV, BIL, MOB) into it, so it is not empty. Default true." }),
  })
  .meta({ id: "CreateWorkspaceRequest", example: { name: "Globex", sampleData: true } });

export const renameWorkspaceBody = z
  .object({ name: workspaceName })
  .meta({ id: "RenameWorkspaceRequest", description: "The slug stays the same.", example: { name: "Globex Corp" } });

/** The frontend's TeamMember (lib/account-data.ts): active members and pending invites in one list. */
export const teamMember = z
  .object({
    id: z.uuid(),
    name: z.string().meta({ description: "For invites: the local part of the email." }),
    email: z.email(),
    initials: z.string(),
    gradient: z.string(),
    role: roleSchema,
    status: z.enum(["active", "invited"]),
    lastActiveAt: z.iso.datetime().nullable().meta({ description: "Null for pending invites." }),
  })
  .meta({
    id: "TeamMember",
    example: {
      id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e03",
      name: "Dmitri Kovac",
      email: "member@devflow.local",
      initials: "DK",
      gradient: "from-sky-500 to-cyan-500",
      role: "member",
      status: "active",
      lastActiveAt: "2026-10-31T22:40:00.000Z",
    },
  });

export const teamMemberPage = pageOf(teamMember).meta({
  id: "TeamMemberPage",
  example: { items: [teamMember.meta()?.example], nextCursor: null },
});

export const changeRoleBody = z
  .object({ role: roleSchema })
  .meta({ id: "ChangeRoleRequest", example: { role: "viewer" } });

export const inviteBody = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: "Enter a valid email address." }).max(254)),
    role: roleSchema,
  })
  .meta({ id: "InviteRequest", example: { email: "grace@acme.dev", role: "member" } });

export const invitePreviewResponse = z
  .object({
    email: z.email(),
    role: roleSchema,
    workspace: z.object({ name: z.string(), slug: z.string() }),
    invitedBy: z.object({ name: z.string() }).nullable(),
    expiresAt: z.iso.datetime(),
    accountExists: z.boolean().meta({
      description:
        "The email already has a DevFlow account: sign in with it and join (POST /invites/{token}/join) instead of accepting.",
    }),
  })
  .meta({
    id: "InvitePreview",
    example: {
      email: "grace@acme.dev",
      role: "member",
      workspace: { name: "Acme Inc", slug: "acme-inc" },
      invitedBy: { name: "John Rey" },
      expiresAt: "2026-11-09T09:00:00.000Z",
      accountExists: false,
    },
  });

export const acceptInviteBody = z
  .object({
    name: z.string().trim().min(1, "Tell us what to call you.").max(48, "Use at most 48 characters."),
    password: z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters."),
  })
  .meta({ id: "AcceptInviteRequest", example: { name: "Grace Hopper", password: "YOUR_PASSWORD" } });

export type WorkspaceView = z.infer<typeof workspaceResponse>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceBody>;
export type RenameWorkspaceInput = z.infer<typeof renameWorkspaceBody>;
export type InvitePreview = z.infer<typeof invitePreviewResponse>;
export type AcceptInviteInput = z.infer<typeof acceptInviteBody>;
export type InviteInput = z.infer<typeof inviteBody>;
export type ChangeRoleInput = z.infer<typeof changeRoleBody>;
export type TeamMember = z.infer<typeof teamMember>;
