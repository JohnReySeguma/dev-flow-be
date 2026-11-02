import { AppError } from "../../lib/errors.js";
import { byCreatedAsc, decodeCursor, toPage, type Page, type PaginationQuery } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import { memberFromInvite, memberFromUser } from "./workspace.mapper.js";
import type { WorkspaceRepository } from "./workspace.repository.js";
import type { TeamMember, WorkspaceView } from "./workspace.schemas.js";

export function createWorkspaceService(deps: { workspaces: WorkspaceRepository }) {
  const { workspaces } = deps;

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
      const [users, invites] = await Promise.all([
        workspaces.listMembers(auth.workspaceId, query.limit, cursor),
        workspaces.listInvites(auth.workspaceId, query.limit, cursor),
      ]);
      const rows = [
        ...users.map((user) => ({ id: user.id, createdAt: user.createdAt, member: memberFromUser(user) })),
        ...invites.map((invite) => ({ id: invite.id, createdAt: invite.createdAt, member: memberFromInvite(invite) })),
      ].sort(byCreatedAsc);
      return toPage(rows.slice(0, query.limit + 1), query.limit, (row) => row.member);
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
