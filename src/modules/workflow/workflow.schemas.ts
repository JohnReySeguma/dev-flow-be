import { z } from "zod";
import { statusCategory } from "../projects/projects.schemas.js";

const statusName = z.string().trim().min(1, "Name the status.").max(32, "Use at most 32 characters.");

export const addStatusBody = z
  .object({ name: statusName, category: statusCategory })
  .meta({ id: "AddStatusRequest", example: { name: "QA", category: "in_progress" } });

export const updateStatusBody = z
  .object({ name: statusName, category: statusCategory })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Send name or category.")
  .meta({ id: "UpdateStatusRequest", example: { category: "done" } });

export const reorderStatusesBody = z.object({ statusIds: z.array(z.uuid()).min(1) }).meta({
  id: "ReorderStatusesRequest",
  description: "Every status id of the project, exactly once, in the new left-to-right order.",
  example: {
    statusIds: [
      "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e21",
      "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e23",
      "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e22",
      "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e24",
    ],
  },
});

export const deleteStatusQuery = z.object({
  moveTo: z
    .uuid()
    .optional()
    .meta({ description: "Status that receives the deleted status's issues. Required when it has issues." }),
});

export type AddStatusInput = z.infer<typeof addStatusBody>;
export type UpdateStatusInput = z.infer<typeof updateStatusBody>;
export type ReorderStatusesInput = z.infer<typeof reorderStatusesBody>;
