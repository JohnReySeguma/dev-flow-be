import type { StatusCategory } from "../../generated/prisma/client.js";

type Status = { id: string; category: StatusCategory };

/** Why a status cannot be deleted, or null if it can (the frontend's cannotDeleteStatusReason). */
export function cannotDeleteStatusReason(workflow: Status[], statusId: string): string | null {
  const status = workflow.find((s) => s.id === statusId);
  if (!status) return "Status not found.";
  if (workflow.length <= 2) return "A workflow needs at least two statuses.";
  const sameCategory = workflow.filter((s) => s.category === status.category);
  if (status.category !== "in_progress" && sameCategory.length === 1) {
    return status.category === "done"
      ? "Keep at least one Done status so sprints can be completed."
      : "Keep at least one To do status so new issues have somewhere to start.";
  }
  return null;
}

/** Why a status cannot move to `category`, or null if it can: a workflow always keeps a to-do and a done status. */
export function cannotRecategoriseReason(
  workflow: Status[],
  statusId: string,
  category: StatusCategory,
): string | null {
  const status = workflow.find((s) => s.id === statusId);
  if (!status) return "Status not found.";
  if (status.category === category || status.category === "in_progress") return null;
  const others = workflow.filter((s) => s.category === status.category && s.id !== statusId);
  if (others.length > 0) return null;
  return status.category === "done"
    ? "Keep at least one Done status so sprints can be completed."
    : "Keep at least one To do status so new issues have somewhere to start.";
}

/** Where a new status goes: before the first done status, so the board reads left to right; done statuses go last. */
export function insertionIndex(workflow: Status[], category: StatusCategory): number {
  const firstDone = workflow.findIndex((s) => s.category === "done");
  return category === "done" || firstDone === -1 ? workflow.length : firstDone;
}
