import type { AuthContext } from "../auth/auth.types.js";
import type { ConfigService } from "../config/config.service.js";
import type { ProjectsService } from "../projects/projects.service.js";
import type { UsersService } from "../users/users.service.js";
import type { WorkspaceService } from "../workspace/workspace.service.js";
import type { Bootstrap } from "./bootstrap.schemas.js";

/** Everything the app shell needs after sign-in, in one round trip. */
export function createBootstrapService(deps: {
  users: UsersService;
  workspace: WorkspaceService;
  config: ConfigService;
  projects: ProjectsService;
}) {
  return {
    async load(auth: AuthContext): Promise<Bootstrap> {
      const [{ profile }, workspace, projects] = await Promise.all([
        deps.users.getProfile(auth.userId),
        deps.workspace.get(auth),
        deps.projects.summaries(auth),
      ]);
      return { me: profile, workspace, config: deps.config.getPublicConfig(), projects };
    },
  };
}

export type BootstrapService = ReturnType<typeof createBootstrapService>;
