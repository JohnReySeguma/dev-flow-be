import type { Sprint } from "../../generated/prisma/client.js";
import type { SprintView } from "./sprints.schemas.js";

export function toSprintView(sprint: Sprint): SprintView {
  const {
    reportCommittedPoints: committedPoints,
    reportCompletedPoints: completedPoints,
    reportCompletedIssues: completedIssues,
    reportCarriedOverIssues: carriedOverIssues,
  } = sprint;
  return {
    id: sprint.id,
    projectId: sprint.projectId,
    number: sprint.number,
    name: sprint.name,
    goal: sprint.goal,
    status: sprint.status,
    startAt: sprint.startAt?.toISOString() ?? null,
    endAt: sprint.endAt?.toISOString() ?? null,
    committedPoints: sprint.committedPoints,
    completedAt: sprint.completedAt?.toISOString() ?? null,
    report:
      committedPoints !== null && completedPoints !== null && completedIssues !== null && carriedOverIssues !== null
        ? { committedPoints, completedPoints, completedIssues, carriedOverIssues }
        : null,
  };
}
