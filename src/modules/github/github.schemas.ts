import { z } from "zod";

/**
 * The parts of GitHub's webhook payloads DevFlow reads. Objects are loose: GitHub sends far more
 * than this and adds fields over time.
 */
export const pullRequestEvent = z.looseObject({
  action: z.string(),
  pull_request: z.looseObject({
    number: z.number().int(),
    title: z.string(),
    draft: z.boolean().optional(),
    merged: z.boolean().nullable().optional(),
    head: z.looseObject({ ref: z.string() }),
  }),
});

const commit = z.looseObject({ id: z.string(), message: z.string() });

export const pushEvent = z.looseObject({
  ref: z.string(),
  deleted: z.boolean().optional(),
  commits: z.array(commit).default([]),
  head_commit: commit.nullable().optional(),
});

export const installationEvent = z.looseObject({
  action: z.string(),
  installation: z.looseObject({ id: z.number().int() }),
});

export const githubStatusResponse = z
  .object({
    enabled: z.boolean().meta({ description: "The server can link installations (GET /config: githubIntegration)." }),
    installations: z.array(
      z.object({
        installationId: z.number().int(),
        account: z.string().meta({ description: "The GitHub user or organisation it is installed on." }),
        linkedAt: z.iso.datetime(),
      }),
    ),
  })
  .meta({
    id: "GitHubStatus",
    example: {
      enabled: true,
      installations: [{ installationId: 51234567, account: "acme", linkedAt: "2026-11-03T09:00:00.000Z" }],
    },
  });

export type GitHubStatus = z.infer<typeof githubStatusResponse>;

export const webhookResult = z
  .object({
    event: z.string().meta({ description: "The X-GitHub-Event header." }),
    handled: z.boolean().meta({
      description: "False for events and actions DevFlow ignores, and for installations not linked to a workspace.",
    }),
    issues: z.array(z.string()).meta({ description: "Keys of the issues that changed." }),
  })
  .meta({ id: "GitHubWebhookResult", example: { event: "pull_request", handled: true, issues: ["DEV-104"] } });

export type WebhookResult = z.infer<typeof webhookResult>;
