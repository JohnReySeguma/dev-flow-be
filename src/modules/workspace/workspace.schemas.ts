import { z } from "zod";
import { pageOf } from "../../lib/pagination.js";
import { roleSchema } from "../users/users.schemas.js";

export const workspaceResponse = z
  .object({
    id: z.uuid(),
    name: z.string(),
    role: roleSchema.meta({ description: "The signed-in user's role in this workspace." }),
  })
  .meta({ id: "Workspace", example: { id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e00", name: "Acme Inc", role: "admin" } });

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

export type WorkspaceView = z.infer<typeof workspaceResponse>;
export type ChangeRoleInput = z.infer<typeof changeRoleBody>;
export type TeamMember = z.infer<typeof teamMember>;
