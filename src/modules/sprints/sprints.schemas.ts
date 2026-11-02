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
