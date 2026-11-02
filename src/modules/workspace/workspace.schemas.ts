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
    workspace: z.object({ name: z.string() }),
    invitedBy: z.object({ name: z.string() }).nullable(),
    expiresAt: z.iso.datetime(),
  })
  .meta({
    id: "InvitePreview",
    example: {
      email: "grace@acme.dev",
      role: "member",
      workspace: { name: "Acme Inc" },
      invitedBy: { name: "John Rey" },
      expiresAt: "2026-11-09T09:00:00.000Z",
    },
  });

export const acceptInviteBody = z
  .object({
    name: z.string().trim().min(1, "Tell us what to call you.").max(48, "Use at most 48 characters."),
    password: z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters."),
  })
  .meta({ id: "AcceptInviteRequest", example: { name: "Grace Hopper", password: "YOUR_PASSWORD" } });

export type WorkspaceView = z.infer<typeof workspaceResponse>;
export type InvitePreview = z.infer<typeof invitePreviewResponse>;
export type AcceptInviteInput = z.infer<typeof acceptInviteBody>;
export type InviteInput = z.infer<typeof inviteBody>;
export type ChangeRoleInput = z.infer<typeof changeRoleBody>;
export type TeamMember = z.infer<typeof teamMember>;
