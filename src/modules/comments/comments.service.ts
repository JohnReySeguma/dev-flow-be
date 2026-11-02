import { decodeCursor, toPage, type Page, type PaginationQuery } from "../../lib/pagination.js";
import type { AuthContext } from "../auth/auth.types.js";
import { issueKeyOf } from "../issues/issues.mapper.js";
import type { IssuesService } from "../issues/issues.service.js";
import { initialsOf } from "../users/users.mapper.js";
import type { CommentsRepository, CommentWithAuthor } from "./comments.repository.js";
import type { CommentView, CreateCommentInput } from "./comments.schemas.js";

const toView =
  (issueKey: string) =>
  (comment: CommentWithAuthor): CommentView => ({
    id: comment.id,
    issueKey,
    author: comment.author
      ? {
          id: comment.author.id,
          name: comment.author.name,
          initials: initialsOf(comment.author.name),
          gradient: comment.author.gradient,
        }
      : null,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  });

export function createCommentsService(deps: { comments: CommentsRepository; issues: IssuesService }) {
  const { comments, issues } = deps;

  return {
    async list(
      auth: AuthContext,
      issueKey: string,
      query: PaginationQuery,
      projectKey?: string,
    ): Promise<Page<CommentView>> {
      const issue = await issues.find(auth, issueKey, projectKey);
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      return toPage(await comments.list(issue.id, query.limit, cursor), query.limit, toView(issueKeyOf(issue)));
    },

    async create(
      auth: AuthContext,
      issueKey: string,
      input: CreateCommentInput,
      projectKey?: string,
    ): Promise<CommentView> {
      const issue = await issues.find(auth, issueKey, projectKey);
      return toView(issueKeyOf(issue))(await comments.create(issue.id, auth.userId, input.body));
    },
  };
}

export type CommentsService = ReturnType<typeof createCommentsService>;
