import { z } from "zod";
import { publicConfigResponse } from "../config/config.schemas.js";
import { projectSummary } from "../projects/projects.schemas.js";
import { userProfile } from "../users/users.schemas.js";
import { workspaceResponse } from "../workspace/workspace.schemas.js";

export const bootstrapResponse = z
  .object({
    me: userProfile,
    workspace: workspaceResponse,
    config: publicConfigResponse,
    projects: z.array(projectSummary),
  })
  .meta({
    id: "Bootstrap",
    example: {
      me: userProfile.meta()?.example,
      workspace: workspaceResponse.meta()?.example,
      config: publicConfigResponse.meta()?.example,
      projects: [projectSummary.meta()?.example],
    },
  });

export type Bootstrap = z.infer<typeof bootstrapResponse>;
