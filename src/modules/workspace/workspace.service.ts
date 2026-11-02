import { z } from "zod";
import type { Role } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { byCreatedAsc, decodeCursor, toPage, type Page, type PaginationQuery } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import { memberFromInvite, memberFromMembership } from "./workspace.mapper.js";
import type { WorkspaceRepository } from "./workspace.repository.js";
import type { TeamMember, WorkspaceView } from "./workspace.schemas.js";

const notFound = () => new AppError("NOT_FOUND", "No member or invite with that id.");
const lastAdmin = () =>
  new AppError("LAST_ADMIN", "The workspace needs at least one admin. Promote someone else first.");

export function createWorkspaceService(deps: {
  workspaces: WorkspaceRepository;
  /** Restores the demo tracker; absent when SEED_DEMO_DATA is false. */
  resetDemo?: (workspaceId: string) => Promise<void>;
}) {
  const { workspaces, resetDemo } = deps;

  return {
    async get(auth: AuthContext): Promise<WorkspaceView> {
      const workspace = await workspaces.findById(auth.workspaceId);
      if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found.");
      return { id: workspace.id, name: workspace.name, role: auth.role };
    },

    /**
     * Active members and pending invites, oldest first. Both tables are read after the same
     * cursor and merged, so the keyset stays correct across the union.
     */
    async listMembers(auth: AuthContext, query: PaginationQuery): Promise<Page<TeamMember>> {
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const [members, invites] = await Promise.all([
        workspaces.listMembers(auth.workspaceId, query.limit, cursor),
        workspaces.listInvites(auth.workspaceId, query.limit, cursor),
      ]);
      const rows = [
        ...members.map((m) => ({ id: m.userId, createdAt: m.createdAt, member: memberFromMembership(m) })),
        ...invites.map((invite) => ({ id: invite.id, createdAt: invite.createdAt, member: memberFromInvite(invite) })),
      ].sort(byCreatedAsc);
      return toPage(rows.slice(0, query.limit + 1), query.limit, (row) => row.member);
    },

    /** Changes a member's or a pending invite's role. Admins only (enforced by the route). */
    async changeRole(auth: AuthContext, id: string, role: Role): Promise<TeamMember> {
      if (!z.uuid().safeParse(id).success) throw notFound();
      if (id === auth.userId) throw new AppError("CANNOT_CHANGE_OWN_ROLE", "Ask another admin to change your role.");

      return workspaces.transaction(async (tx) => {
        // Lock first, then read: the target's role is then current, not a pre-lock snapshot.
        const admins = await tx.lockAdminIds(auth.workspaceId);
        const member = await tx.findMember(auth.workspaceId, id);
        if (member) {
          if (member.role === "admin" && role !== "admin" && admins.length <= 1) throw lastAdmin();
          return memberFromMembership(await tx.setMemberRole(auth.workspaceId, id, role));
        }
        const invite = await tx.findInvite(auth.workspaceId, id);
        if (!invite) throw notFound();
        return memberFromInvite(await tx.setInviteRole(id, role));
      });
    },

    /** Restores the demo projects, sprints and issues. Only on deployments that seed demo data. */
    async resetDemoData(auth: AuthContext): Promise<void> {
      if (!resetDemo) throw new AppError("NOT_FOUND", "Demo data is not enabled on this server.");
      await resetDemo(auth.workspaceId);
    },

    /** Removes a member (ending their sessions and tokens) or revokes a pending invite. */
    async remove(auth: AuthContext, id: string): Promise<void> {
      if (!z.uuid().safeParse(id).success) throw notFound();
      if (id === auth.userId) {
        throw new AppError("CANNOT_REMOVE_SELF", "Ask another admin to remove you from the workspace.");
      }

      await workspaces.transaction(async (tx) => {
        const admins = await tx.lockAdminIds(auth.workspaceId);
        const member = await tx.findMember(auth.workspaceId, id);
        if (member) {
          if (member.role === "admin" && admins.length <= 1) throw lastAdmin();
          await tx.deleteMember(id);
          return;
        }
        const invite = await tx.findInvite(auth.workspaceId, id);
        if (!invite) throw notFound();
        await tx.deleteInvite(id);
      });
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
