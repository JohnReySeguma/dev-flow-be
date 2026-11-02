import { z } from "zod";
import type { Role } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { byCreatedAsc, decodeCursor, toPage, type Page, type PaginationQuery } from "../../lib/pagination.js";
import type { AuthContext, Identity } from "../auth/auth.types.js";
import { memberFromInvite, memberFromMembership, toWorkspaceView } from "./workspace.mapper.js";
import type { WorkspaceRepository } from "./workspace.repository.js";
import type { CreateWorkspaceInput, TeamMember, WorkspaceView } from "./workspace.schemas.js";

const notFound = () => new AppError("NOT_FOUND", "No member or invite with that id.");
const lastAdmin = () =>
  new AppError("LAST_ADMIN", "The workspace needs at least one admin. Promote someone else first.");

export function createWorkspaceService(deps: {
  workspaces: WorkspaceRepository;
  /** Copies the sample projects into a new workspace for its owner. */
  copySampleData: (workspaceId: string, ownerId: string) => Promise<void>;
  /** Restores the demo tracker; absent when SEED_DEMO_DATA is false. */
  resetDemo?: (workspaceId: string) => Promise<void>;
}) {
  const { workspaces, copySampleData, resetDemo } = deps;

  return {
    /** A new workspace with `userId` as its admin, by default with a copy of the sample projects. */
    async create(userId: string, input: CreateWorkspaceInput): Promise<WorkspaceView> {
      const workspace = await workspaces.create(input.name, { ownerId: userId });
      if (input.sampleData) await copySampleData(workspace.id, userId);
      return toWorkspaceView(workspace, "admin");
    },

    /** The user's workspaces with their role in each, oldest membership first. */
    async list(userId: string, query: PaginationQuery): Promise<Page<WorkspaceView>> {
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const rows = await workspaces.listMembershipsPage(userId, query.limit, cursor);
      return toPage(
        rows.map((m) => ({ id: m.workspaceId, createdAt: m.createdAt, view: toWorkspaceView(m.workspace, m.role) })),
        query.limit,
        (row) => row.view,
      );
    },

    /** Admins only (enforced by the route). The slug stays, so links keep working. */
    async rename(auth: AuthContext, name: string): Promise<WorkspaceView> {
      return toWorkspaceView(await workspaces.rename(auth.workspaceId, name), auth.role);
    },

    /** Admins only (enforced by the route). Deletes everything in the workspace; there is no undo. */
    async delete(auth: AuthContext): Promise<void> {
      await workspaces.delete(auth.workspaceId);
    },

    /**
     * Leaves the workspace. The last admin cannot leave while others remain (promote someone
     * first), and the only member deletes the workspace instead.
     */
    async leave(auth: AuthContext): Promise<void> {
      await workspaces.transaction(async (tx) => {
        const admins = await tx.lockAdminIds(auth.workspaceId);
        if (auth.role === "admin" && admins.length <= 1) {
          const alone = (await tx.countMembers(auth.workspaceId)) === 1;
          throw new AppError(
            "LAST_ADMIN",
            alone
              ? "You are the only member. Delete the workspace instead of leaving it."
              : "The workspace needs at least one admin. Promote someone else first.",
          );
        }
        await tx.removeMembership(auth.workspaceId, auth.userId);
      });
    },

    /**
     * The caller inside the workspace with this slug. Non-members, and access tokens bound to
     * another workspace, get the same 404 as an unknown slug.
     */
    async enter(identity: Identity, slug: string): Promise<AuthContext> {
      const membership = await workspaces.findMembershipBySlug(identity.userId, slug);
      if (!membership || (identity.via === "token" && identity.tokenWorkspaceId !== membership.workspaceId)) {
        throw new AppError("NOT_FOUND", "Workspace not found.");
      }
      const { workspace } = membership;
      return {
        ...identity,
        workspaceId: workspace.id,
        role: membership.role,
        workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name, isDemo: workspace.isDemo },
      };
    },

    /** Every workspace the user belongs to, with their role in each, oldest first. */
    async listMine(userId: string): Promise<WorkspaceView[]> {
      return (await workspaces.listMemberships(userId)).map((m) => toWorkspaceView(m.workspace, m.role));
    },

    get(auth: AuthContext): WorkspaceView {
      return toWorkspaceView(auth.workspace, auth.role);
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
