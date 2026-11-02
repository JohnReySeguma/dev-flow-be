import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import type { AuthContext } from "../auth/auth.types.js";
import { nextResolvedAt } from "../issues/issues.service.js";
import type { ProjectsService, VersionedProject } from "../projects/projects.service.js";
import type { WorkflowRepository } from "./workflow.repository.js";
import { cannotDeleteStatusReason, cannotRecategoriseReason, insertionIndex } from "./workflow.rules.js";
import type { AddStatusInput, ReorderStatusesInput, UpdateStatusInput } from "./workflow.schemas.js";

type Tx = Parameters<Parameters<WorkflowRepository["transaction"]>[0]>[0];

const invalid = (field: string, message: string) =>
  new AppError("VALIDATION_FAILED", "The request contains invalid fields.", { errors: [{ field, message }] });

const notFound = () => new AppError("NOT_FOUND", "No status with that id in this project.");

export function createWorkflowService(deps: { workflow: WorkflowRepository; projects: ProjectsService }) {
  const { workflow, projects } = deps;

  /** Runs `change` with the project locked, then returns the project with its new workflow. */
  async function edit(
    auth: AuthContext,
    key: string,
    change: (tx: Tx, projectId: string) => Promise<void>,
  ): Promise<VersionedProject> {
    const project = await projects.find(auth, key);
    await workflow.transaction(async (tx) => {
      await tx.lockProject(project.id);
      await change(tx, project.id);
      await tx.touchProject(project.id);
    });
    return projects.get(auth, key);
  }

  return {
    add(auth: AuthContext, key: string, input: AddStatusInput) {
      return edit(auth, key, async (tx, projectId) => {
        const statuses = await tx.listStatuses(projectId);
        const at = insertionIndex(statuses, input.category);
        const created = await tx.createStatus({ projectId, ...input, position: statuses.length });
        const ids = statuses.map((s) => s.id);
        ids.splice(at, 0, created.id);
        await tx.setOrder(ids);
      });
    },

    update(auth: AuthContext, key: string, statusId: string, input: UpdateStatusInput) {
      return edit(auth, key, async (tx, projectId) => {
        const statuses = await tx.listStatuses(projectId);
        const current = statuses.find((s) => s.id === statusId);
        if (!current) throw notFound();
        if (input.category && input.category !== current.category) {
          const reason = cannotRecategoriseReason(statuses, statusId, input.category);
          if (reason) throw new AppError("STATUS_UPDATE_BLOCKED", reason);
        }
        await tx.updateStatus(statusId, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.category !== undefined && { category: input.category }),
        });

        const wasDone = current.category === "done";
        const isDone = (input.category ?? current.category) === "done";
        if (wasDone !== isDone) {
          // Issues sitting in a status that became (or stopped being) done resolve accordingly.
          await tx.resolveIssuesInStatus(statusId, isDone, new Date());
          const affected = await tx.issuesInStatus(statusId);
          await tx.recordEvents(
            affected.map((issue) => ({
              issueId: issue.id,
              projectId,
              actorId: auth.userId,
              sprintId: issue.sprintId,
              statusId,
              estimate: issue.estimate,
              done: isDone,
            })),
          );
        }
      });
    },

    reorder(auth: AuthContext, key: string, input: ReorderStatusesInput) {
      return edit(auth, key, async (tx, projectId) => {
        const current = (await tx.listStatuses(projectId)).map((s) => s.id);
        const proposed = new Set(input.statusIds);
        if (
          proposed.size !== input.statusIds.length ||
          proposed.size !== current.length ||
          current.some((id) => !proposed.has(id))
        ) {
          throw invalid("statusIds", "List every status of this project exactly once.");
        }
        await tx.setOrder(input.statusIds);
      });
    },

    /** Moves the status's issues to `moveTo`, then deletes the status. */
    remove(auth: AuthContext, key: string, statusId: string, moveTo?: string) {
      return edit(auth, key, async (tx, projectId) => {
        const statuses = await tx.listStatuses(projectId);
        const current = z.uuid().safeParse(statusId).success ? statuses.find((s) => s.id === statusId) : undefined;
        if (!current) throw notFound();
        const reason = cannotDeleteStatusReason(statuses, statusId);
        if (reason) throw new AppError("STATUS_DELETE_BLOCKED", reason);

        const issues = await tx.issuesInStatus(statusId);
        if (issues.length > 0) {
          const target = statuses.find((s) => s.id === moveTo && s.id !== statusId);
          if (!target) {
            throw invalid("moveTo", "Pick another status of this project to receive this status's issues.");
          }
          const now = new Date();
          for (const issue of issues) {
            await tx.moveIssue(
              issue.id,
              target.id,
              nextResolvedAt(issue.resolvedAt, current.category, target.category, now),
            );
          }
          await tx.recordEvents(
            issues.map((issue) => ({
              issueId: issue.id,
              projectId,
              actorId: auth.userId,
              sprintId: issue.sprintId,
              statusId: target.id,
              estimate: issue.estimate,
              done: target.category === "done",
            })),
          );
        }
        await tx.deleteStatus(statusId);
        await tx.setOrder(statuses.filter((s) => s.id !== statusId).map((s) => s.id));
      });
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
