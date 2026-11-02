import type { WorkspaceInvite } from "../../generated/prisma/client.js";
import { initialsOf } from "../users/users.mapper.js";
import type { Member } from "./workspace.repository.js";
import type { TeamMember } from "./workspace.schemas.js";

/** The neutral avatar the frontend shows for pending invites. */
export const INVITE_GRADIENT = "from-zinc-600 to-zinc-700";

export function memberFromMembership({ user, role }: Member): TeamMember {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    initials: initialsOf(user.name),
    gradient: user.gradient,
    role,
    status: "active",
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
  };
}

/** Matches how the frontend renders an invite before it is accepted. */
export function memberFromInvite(invite: WorkspaceInvite): TeamMember {
  const local = invite.email.split("@")[0] ?? invite.email;
  return {
    id: invite.id,
    name: local,
    email: invite.email,
    initials: local.slice(0, 2).toUpperCase(),
    gradient: INVITE_GRADIENT,
    role: invite.role,
    status: "invited",
    lastActiveAt: null,
  };
}
