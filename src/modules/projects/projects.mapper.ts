import type { ProjectWithWorkflow } from "./projects.repository.js";
import type { ProjectView } from "./projects.schemas.js";

export function toProjectView(project: ProjectWithWorkflow): ProjectView {
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    color: project.color,
    leadId: project.leadId,
    workflow: project.statuses.map((status) => ({ id: status.id, name: status.name, category: status.category })),
    nextIssueNumber: project.nextIssueNumber,
    createdAt: project.createdAt.toISOString(),
  };
}
