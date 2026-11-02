import { z } from "zod";

export const sprintReport = z
  .object({
    committedPoints: z.number().int(),
    completedPoints: z.number().int(),
    completedIssues: z.number().int(),
    carriedOverIssues: z.number().int(),
  })
  .meta({
    id: "SprintReport",
    example: { committedPoints: 40, completedPoints: 33, completedIssues: 12, carriedOverIssues: 3 },
  });

/** The frontend's Sprint. */
export const sprint = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    number: z.number().int(),
    name: z.string(),
    goal: z.string(),
    status: z.enum(["planned", "active", "completed"]),
    startAt: z.iso.datetime().nullable(),
    endAt: z.iso.datetime().nullable(),
    committedPoints: z.number().int().nullable().meta({ description: "Points in the sprint when it started." }),
    completedAt: z.iso.datetime().nullable(),
    report: sprintReport.nullable().meta({ description: "Set when the sprint completes." }),
  })
  .meta({
    id: "Sprint",
    example: {
      id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e30",
      projectId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e20",
      number: 25,
      name: "Sprint 25",
      goal: "Ship SSO for enterprise tenants and stabilise token refresh.",
      status: "active",
      startAt: "2026-10-26T09:00:00.000Z",
      endAt: "2026-11-09T09:00:00.000Z",
      committedPoints: 50,
      completedAt: null,
      report: null,
    },
  });

export type SprintView = z.infer<typeof sprint>;

export const sprintPage = z
  .object({
    items: z.array(sprint),
    nextCursor: z.string().nullable().meta({ description: "Pass as ?cursor= for the next page; null on the last." }),
  })
  .meta({ id: "SprintPage", example: { items: [sprint.meta()?.example], nextCursor: null } });

export const listSprintsQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const statuses = value.split(",").map((s) => s.trim());
      const parsed = z.array(z.enum(["planned", "active", "completed"])).safeParse(statuses);
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: "Use planned, active and/or completed, comma-separated." });
        return z.NEVER;
      }
      return parsed.data;
    })
    .meta({ description: "Comma-separated filter, e.g. planned,active.", example: "planned,active" }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(20).optional(),
});

const sprintName = z.string().trim().min(1, "Name the sprint.").max(64, "Use at most 64 characters.");
const sprintGoal = z.string().trim().max(500, "Use at most 500 characters.");

export const updateSprintBody = z
  .object({ name: sprintName, goal: sprintGoal })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Send name or goal.")
  .meta({ id: "UpdateSprintRequest", example: { goal: "Cycle analytics v1." } });

export type ListSprintsQuery = z.infer<typeof listSprintsQuery>;
export type UpdateSprintInput = z.infer<typeof updateSprintBody>;
