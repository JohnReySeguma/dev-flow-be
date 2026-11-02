import { gitLink, type IssueView } from "./issues.schemas.js";
import type { IssueWithContext } from "./issues.repository.js";

export const issueKeyOf = (issue: IssueWithContext) => `${issue.project.key}-${issue.number}`;

/** The frontend's Issue. Optional fields (`git`, `dueAt`) are omitted rather than null, as in its types. */
export function toIssueView(issue: IssueWithContext): IssueView {
  const git = gitLink.safeParse(issue.git);
  return {
    id: issueKeyOf(issue),
    projectId: issue.projectId,
    sprintId: issue.sprintId,
    statusId: issue.statusId,
    type: issue.type,
    priority: issue.priority,
    title: issue.title,
    description: issue.description,
    assigneeId: issue.assigneeId,
    tags: issue.tags,
    ...(git.success && { git: git.data }),
    estimate: issue.estimate,
    comments: issue.commentCount,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    ...(issue.dueAt && { dueAt: issue.dueAt.toISOString() }),
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
  };
}
