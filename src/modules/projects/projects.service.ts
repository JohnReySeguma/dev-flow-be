import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { ifMatchSatisfied, versionTag } from "../../lib/etag.js";
import { decodeCursor, toPage, type Page, type PaginationQuery } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import { toIssueView } from "../issues/issues.mapper.js";
import type { IssueView } from "../issues/issues.schemas.js";
import { toSprintView } from "../sprints/sprints.mapper.js";
import type { SprintView } from "../sprints/sprints.schemas.js";
import { initialsOf } from "../users/users.mapper.js";
import { toProjectView } from "./projects.mapper.js";
import type { ProjectsRepository, ProjectWithWorkflow } from "./projects.repository.js";
import {
  DEFAULT_WORKFLOW,
  PROJECT_COLORS,
  PROJECT_KEY,
  type CreateProjectInput,
  type ProjectSummary,
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

  /** Adds active-sprint progress, backlog size and lead to each project, in four queries in total. */
  async function summarise(rows: ProjectWithWorkflow[]): Promise<ProjectSummary[]> {
    const ids = rows.map((p) => p.id);
    const [sprints, backlog, leads] = await Promise.all([
      projects.activeSprints(ids),
      projects.backlogCounts(ids),
      projects.leads(rows.flatMap((p) => (p.leadId ? [p.leadId] : []))),
    ]);
    const sprintIssues = await projects.issuesInSprints(sprints.map((s) => s.id));

    return rows.map((row) => {
      const sprint = sprints.find((s) => s.projectId === row.id);
      const inSprint = sprint ? sprintIssues.filter((i) => i.sprintId === sprint.id) : [];
      const done = inSprint.filter((i) => i.status.category === "done");
      const points = (issues: typeof inSprint) => issues.reduce((sum, i) => sum + (i.estimate ?? 0), 0);
      const lead = leads.find((u) => u.id === row.leadId);
      return {
        ...toProjectView(row),
        activeSprint: sprint
          ? {
              name: sprint.name,
              endAt: sprint.endAt?.toISOString() ?? null,
              donePoints: points(done),
              totalPoints: points(inSprint),
              doneIssues: done.length,
              totalIssues: inSprint.length,
            }
          : null,
        backlogCount: backlog.get(row.id) ?? 0,
        lead: lead ? { id: lead.id, name: lead.name, initials: initialsOf(lead.name), gradient: lead.gradient } : null,
      };
    });
  }

  return {
    find,

    async list(auth: AuthContext, query: PaginationQuery): Promise<Page<ProjectSummary>> {
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const rows = await projects.list(auth.workspaceId, query.limit, cursor);
      const page = toPage(rows, query.limit, (row) => row);
      return { items: await summarise(page.items), nextCursor: page.nextCursor };
    },

    /** Every project with its summary, for /bootstrap. */
    async summaries(auth: AuthContext): Promise<ProjectSummary[]> {
      return summarise(await projects.listAll(auth.workspaceId));
    },

    /** Everything needed to render one project: workflow, all sprints, and every open issue in rank order. */
    async snapshot(
      auth: AuthContext,
      key: string,
    ): Promise<{ project: ProjectView; sprints: SprintView[]; issues: IssueView[] }> {
      const project = await find(auth, key);
      const [sprints, issues] = await Promise.all([projects.sprints(project.id), projects.openIssues(project.id)]);
      return { project: toProjectView(project), sprints: sprints.map(toSprintView), issues: issues.map(toIssueView) };
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
