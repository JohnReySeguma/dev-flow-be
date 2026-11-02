import { z } from "zod";
import { pageOf } from "../../lib/pagination.js";

/** Gradients for new projects, assigned in turn (the frontend's PROJECT_COLORS). */
export const PROJECT_COLORS = [
  "from-sky-500 to-cyan-500",
  "from-amber-500 to-yellow-600",
  "from-fuchsia-500 to-pink-600",
  "from-violet-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
] as const;

/** The frontend's DEFAULT_WORKFLOW_NAMES. */
export const DEFAULT_WORKFLOW = [
  { name: "To Do", category: "todo" },
  { name: "In Progress", category: "in_progress" },
  { name: "In Review", category: "in_progress" },
  { name: "Done", category: "done" },
] as const;

export const PROJECT_KEY = /^[A-Z]{2,5}$/;

export const statusCategory = z.enum(["todo", "in_progress", "done"]);

/** The frontend's WorkflowStatus. */
export const workflowStatus = z.object({ id: z.uuid(), name: z.string(), category: statusCategory }).meta({
  id: "WorkflowStatus",
  example: { id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e21", name: "In Review", category: "in_progress" },
});

/** The frontend's Project, with its workflow in board order. */
export const project = z
  .object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    description: z.string(),
    color: z.string(),
    leadId: z.uuid().nullable(),
    workflow: z.array(workflowStatus),
    nextIssueNumber: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .meta({
    id: "Project",
    example: {
      id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e20",
      key: "DEV",
      name: "DevFlow Core",
      description: "The web app: board, realtime sync, auth and the public API gateway.",
      color: "from-violet-500 to-indigo-600",
      leadId: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e01",
      workflow: [
        { id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e21", name: "To Do", category: "todo" },
        { id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e22", name: "In Progress", category: "in_progress" },
        { id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e23", name: "In Review", category: "in_progress" },
        { id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e24", name: "Done", category: "done" },
      ],
      nextIssueNumber: 134,
      createdAt: "2026-05-05T09:00:00.000Z",
    },
  });

export const projectPage = pageOf(project).meta({
  id: "ProjectPage",
  example: { items: [project.meta()?.example], nextCursor: null },
});

const name = z.string().trim().min(1, "Name the project.").max(64, "Use at most 64 characters.");
const description = z.string().trim().max(500, "Use at most 500 characters.");

export const createProjectBody = z
  .object({
    name,
    key: z.string().trim().toUpperCase().regex(PROJECT_KEY, "Use 2 to 5 letters, e.g. DEV."),
    description: description.default(""),
  })
  .meta({
    id: "CreateProjectRequest",
    example: { name: "Mobile App", key: "MOB", description: "React Native client for iOS and Android." },
  });

export const updateProjectBody = z
  .object({ name, description })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Send name or description. The key cannot change.")
  .meta({ id: "UpdateProjectRequest", example: { description: "Board, realtime sync and auth." } });

export type ProjectView = z.infer<typeof project>;
export type CreateProjectInput = z.infer<typeof createProjectBody>;
export type UpdateProjectInput = z.infer<typeof updateProjectBody>;
