import type { GitHubInstallation } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

export function createGitHubRepository(prisma: PrismaClient) {
  return {
    find: (installationId: number): Promise<GitHubInstallation | null> =>
      prisma.gitHubInstallation.findUnique({ where: { installationId: BigInt(installationId) } }),

    listForWorkspace: (workspaceId: string): Promise<GitHubInstallation[]> =>
      prisma.gitHubInstallation.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),

    link: (data: { installationId: number; workspaceId: string; accountLogin: string; linkedById: string }) =>
      prisma.gitHubInstallation.upsert({
        where: { installationId: BigInt(data.installationId) },
        create: { ...data, installationId: BigInt(data.installationId) },
        update: { accountLogin: data.accountLogin },
      }),

    /** Returns false when the installation is not linked to that workspace. */
    unlink: async (workspaceId: string, installationId: number): Promise<boolean> =>
      (await prisma.gitHubInstallation.deleteMany({ where: { workspaceId, installationId: BigInt(installationId) } }))
        .count === 1,

    /** The App was uninstalled on GitHub. */
    remove: (installationId: number) =>
      prisma.gitHubInstallation.deleteMany({ where: { installationId: BigInt(installationId) } }),
  };
}

export type GitHubRepository = ReturnType<typeof createGitHubRepository>;
