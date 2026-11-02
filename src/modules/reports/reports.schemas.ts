import { z } from "zod";
import { sprint } from "../sprints/sprints.schemas.js";

export const burndownResponse = z
  .object({
    sprintId: z.uuid(),
    committedPoints: z.number().int().nullable(),
    days: z.array(
      z.object({
        date: z.iso.datetime().meta({ description: "Sprint start plus n days." }),
        ideal: z.number(),
        remaining: z.number().int().nullable().meta({ description: "Null for days that have not happened yet." }),
      }),
    ),
  })
  .meta({
    id: "Burndown",
    example: {
      sprintId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e30",
      committedPoints: 45,
      days: [
        { date: "2026-10-27T09:00:00.000Z", ideal: 45, remaining: 45 },
        { date: "2026-10-28T09:00:00.000Z", ideal: 41.79, remaining: 42 },
        { date: "2026-10-29T09:00:00.000Z", ideal: 38.57, remaining: null },
      ],
    },
  });

export const velocityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8).meta({ description: "How many recent sprints." }),
});

export const velocityResponse = z
  .array(z.object({ sprintId: z.uuid(), name: z.string(), committed: z.number().int(), completed: z.number().int() }))
  .meta({
    id: "Velocity",
    description: "The most recent completed sprints, oldest first (chart order).",
    example: [
      { sprintId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e31", name: "Sprint 23", committed: 31, completed: 31 },
      { sprintId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e32", name: "Sprint 24", committed: 40, completed: 33 },
    ],
  });

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(40).optional(),
});

export const historyResponse = z
  .object({
    items: z.array(sprint),
    nextCursor: z.string().nullable().meta({ description: "Pass as ?cursor= for the next page; null on the last." }),
  })
  .meta({
    id: "SprintHistory",
    description: "Completed sprints with goal, dates and report, newest first.",
    example: {
      items: [
        {
          ...(sprint.meta()?.example as object),
          number: 24,
          name: "Sprint 24",
          goal: "Realtime presence and Live Sync",
          status: "completed",
          completedAt: "2026-10-26T09:00:00.000Z",
          report: { committedPoints: 40, completedPoints: 33, completedIssues: 12, carriedOverIssues: 3 },
        },
      ],
      nextCursor: null,
    },
  });

export type Burndown = z.infer<typeof burndownResponse>;
export type Velocity = z.infer<typeof velocityResponse>;
export type VelocityQuery = z.infer<typeof velocityQuery>;
export type HistoryQuery = z.infer<typeof historyQuery>;
