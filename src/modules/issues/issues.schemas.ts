import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";

/** The frontend's ESTIMATES. */
export const ESTIMATES = [1, 2, 3, 5, 8, 13] as const;

export const issueType = z.enum(["story", "bug", "task"]);
export const priority = z.enum(["urgent", "high", "medium", "low"]);
const estimate = z
  .number()
  .int()
  .refine((value) => (ESTIMATES as readonly number[]).includes(value), "Use 1, 2, 3, 5, 8 or 13 points, or null.")
  .nullable();

export const gitLink = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("pr"), number: z.number().int(), state: z.enum(["open", "merged", "draft"]) }),
    z.object({ kind: z.literal("commit"), sha: z.string() }),
  ])
  .meta({ id: "GitLink", example: { kind: "pr", number: 421, state: "open" } });

/** The frontend's Issue. `id` is the human-readable key (DEV-104). */
export const issue = z
  .object({
    id: z.string().meta({ description: "The issue key, e.g. DEV-104." }),
    projectId: z.uuid(),
    sprintId: z.uuid().nullable().meta({ description: "Null = in the backlog." }),
    statusId: z.uuid(),
    type: issueType,
    priority,
    title: z.string(),
    description: z.string(),
    assigneeId: z.uuid().nullable(),
    tags: z.array(z.string()),
    git: gitLink.optional(),
    estimate: z.number().int().nullable(),
    comments: z.number().int().meta({ description: "Number of comments." }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    dueAt: z.iso.datetime().optional(),
    resolvedAt: z.iso.datetime().nullable().meta({ description: "Set while the issue is in a done-category status." }),
  })
  .meta({
    id: "Issue",
    example: {
      id: "DEV-104",
      projectId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e20",
      sprintId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e30",
      statusId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e22",
      type: "bug",
      priority: "urgent",
      title: "OAuth refresh token rotation fails on concurrent tabs",
      description: "Two tabs refreshing at the same time both present the old refresh token.",
      assigneeId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e01",
      tags: ["auth", "frontend"],
      git: { kind: "pr", number: 421, state: "open" },
      estimate: 5,
      comments: 12,
      createdAt: "2026-10-27T08:00:00.000Z",
      updatedAt: "2026-11-01T07:48:00.000Z",
      dueAt: "2026-10-31T09:00:00.000Z",
      resolvedAt: null,
    },
  });

export const issuePage = z
  .object({
    items: z.array(issue),
    nextCursor: z.string().nullable().meta({ description: "Pass as ?cursor= for the next page; null on the last." }),
  })
  .meta({ id: "IssuePage", example: { items: [issue.meta()?.example], nextCursor: null } });

export const createIssueBody = z
  .object({
    title: z.string().trim().min(1, "Give the issue a title.").max(200, "Use at most 200 characters."),
    description: z.string().max(20_000, "Use at most 20,000 characters.").default(""),
    type: issueType.default("task"),
    priority: priority.default("medium"),
    assigneeId: z.uuid().nullable().default(null),
    estimate: estimate.default(null),
    sprintId: z.uuid().nullable().default(null),
    statusId: z.uuid().optional().meta({ description: "Defaults to the project's first to-do status." }),
  })
  .meta({
    id: "CreateIssueRequest",
    example: {
      title: "Export board as CSV",
      type: "story",
      priority: "low",
      assigneeId: null,
      estimate: 3,
      sprintId: null,
    },
  });

export const updateIssueBody = z
  .object({
    title: z.string().trim().min(1, "Give the issue a title.").max(200, "Use at most 200 characters."),
    description: z.string().max(20_000, "Use at most 20,000 characters."),
    type: issueType,
    priority,
    assigneeId: z.uuid().nullable(),
    estimate,
    statusId: z.uuid(),
    sprintId: z.uuid().nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Send at least one field to change.")
  .meta({ id: "UpdateIssueRequest", example: { priority: "high", estimate: 8 } });

export const listIssuesQuery = paginationQuery.extend({
  sprint: z
    .union([z.literal("backlog"), z.literal("active"), z.uuid()])
    .optional()
    .meta({ description: "A sprint id, `backlog` (no sprint) or `active` (the active sprint)." }),
  assignee: z
    .union([z.literal("none"), z.uuid()])
    .optional()
    .meta({ description: "A user id, or `none` for unassigned." }),
  priority: priority.optional(),
  type: issueType.optional(),
  q: z.string().trim().min(1).max(200).optional().meta({ description: "Matches the key, title or description." }),
  mine: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
    .meta({ description: "`true` = assigned to you." }),
});

export const issueLookupQuery = z.object({
  project: z
    .string()
    .optional()
    .meta({ description: "Project key; required when :issueKey is a bare number such as 104." }),
});

export type IssueView = z.infer<typeof issue>;
export type CreateIssueInput = z.infer<typeof createIssueBody>;
export type UpdateIssueInput = z.infer<typeof updateIssueBody>;
export type ListIssuesQuery = z.infer<typeof listIssuesQuery>;
