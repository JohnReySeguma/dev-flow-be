import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { ifMatchSatisfied, versionTag } from "../../lib/etag.js";
import { decodeCursor, toPage, type Page, type PaginationQuery } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import { toProjectView } from "./projects.mapper.js";
import type { ProjectsRepository, ProjectWithWorkflow } from "./projects.repository.js";
import {
  DEFAULT_WORKFLOW,
  PROJECT_COLORS,
  PROJECT_KEY,
  type CreateProjectInput,
  type ProjectView,
  type UpdateProjectInput,
} from "./projects.schemas.js";

export type VersionedProject = { project: ProjectView; etag: string };

const versioned = (project: ProjectWithWorkflow): VersionedProject => ({
  project: toProjectView(project),
  etag: versionTag(project.id, project.updatedAt),
});

const stale = () => new AppError("CONFLICT_STALE", "The project changed since it was loaded. Reload and try again.");

export function createProjectsService(deps: { projects: ProjectsRepository }) {
  const { projects } = deps;

  /** Resolves `:key` (any case) within the caller's workspace, or 404. */
  async function find(auth: AuthContext, key: string): Promise<ProjectWithWorkflow> {
    const normalised = key.toUpperCase();
    const project = PROJECT_KEY.test(normalised) ? await projects.findByKey(auth.workspaceId, normalised) : null;
    if (!project) throw new AppError("NOT_FOUND", `No project with key ${normalised}.`);
    return project;
  }

  return {
    find,

    async list(auth: AuthContext, query: PaginationQuery): Promise<Page<ProjectView>> {
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      return toPage(await projects.list(auth.workspaceId, query.limit, cursor), query.limit, toProjectView);
    },

    async get(auth: AuthContext, key: string): Promise<VersionedProject> {
      return versioned(await find(auth, key));
    },

    /** Creates the project with the default four-column workflow; the creator leads it. */
    async create(auth: AuthContext, input: CreateProjectInput): Promise<VersionedProject> {
      const count = await projects.countInWorkspace(auth.workspaceId);
      try {
        return versioned(
          await projects.create({
            workspaceId: auth.workspaceId,
            key: input.key,
            name: input.name,
            description: input.description,
            color: PROJECT_COLORS[count % PROJECT_COLORS.length] ?? PROJECT_COLORS[0],
            leadId: auth.userId,
            statuses: DEFAULT_WORKFLOW.map((status) => ({ ...status })),
          }),
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError("PROJECT_KEY_TAKEN", `The key ${input.key} is already used by another project.`);
        }
        throw error;
      }
    },

    /** With `ifMatch`, rejects the change (412) if the project changed since the client read it. */
    async update(auth: AuthContext, key: string, input: UpdateProjectInput, ifMatch?: string) {
      const current = await find(auth, key);
      if (ifMatch !== undefined && !ifMatchSatisfied(ifMatch, versionTag(current.id, current.updatedAt))) {
        throw stale();
      }
      const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const updated = await projects.update(current.id, data, ifMatch === undefined ? undefined : current.updatedAt);
      if (!updated) throw stale();
      return versioned(updated);
    },

    async remove(auth: AuthContext, key: string): Promise<void> {
      await projects.delete((await find(auth, key)).id);
    },
  };
}

export type ProjectsService = ReturnType<typeof createProjectsService>;
