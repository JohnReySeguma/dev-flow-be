import type { Workspace } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

export function createWorkspaceRepository(prisma: PrismaClient) {
  return {
    findById: (id: string): Promise<Workspace | null> => prisma.workspace.findUnique({ where: { id } }),
    /** The single workspace (multiple workspaces are out of scope). */
    findDefault: (): Promise<Workspace | null> => prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } }),
    create: (name: string): Promise<Workspace> => prisma.workspace.create({ data: { name } }),
  };
}

export type WorkspaceRepository = ReturnType<typeof createWorkspaceRepository>;
