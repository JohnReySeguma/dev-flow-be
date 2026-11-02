import { z } from "zod";

export const publicConfigResponse = z
  .object({
    oauth: z.object({
      github: z.boolean().meta({ description: "Show “Continue with GitHub”." }),
      google: z.boolean().meta({ description: "Show “Continue with Google”." }),
    }),
    githubIntegration: z.boolean().meta({ description: "GitHub App webhooks link PRs and commits to issues." }),
    email: z.boolean().meta({
      description:
        "Emails (password reset, invites) are really delivered. When false they are only written to the server log.",
    }),
  })
  .meta({
    id: "PublicConfig",
    example: { oauth: { github: true, google: false }, githubIntegration: false, email: false },
  });

export type PublicConfig = z.infer<typeof publicConfigResponse>;
