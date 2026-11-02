import type { Prisma } from "../../generated/prisma/client.js";
import { afterCursorAsc, type Cursor } from "../../lib/pagination.js";
import type { PrismaClient } from "../../lib/prisma.js";

const withAuthor = { author: { select: { id: true, name: true, gradient: true } } } as const;

export type CommentWithAuthor = Prisma.IssueCommentGetPayload<{ include: typeof withAuthor }>;

export function createCommentsRepository(prisma: PrismaClient) {
  return {
    /** Oldest first; fetches `limit + 1` so the caller can tell whether more exist. */
    list: (issueId: string, limit: number, cursor?: Cursor): Promise<CommentWithAuthor[]> =>
      prisma.issueComment.findMany({
        where: { issueId, ...(cursor && afterCursorAsc(cursor)) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        include: withAuthor,
      }),

    /** Adds the comment and bumps the issue's comment count in one transaction. */
    create: (issueId: string, authorId: string, body: string): Promise<CommentWithAuthor> =>
      prisma.$transaction(async (tx) => {
        const created = await tx.issueComment.create({ data: { issueId, authorId, body }, include: withAuthor });
        await tx.issue.update({ where: { id: issueId }, data: { commentCount: { increment: 1 } } });
        return created;
      }),
  };
}

export type CommentsRepository = ReturnType<typeof createCommentsRepository>;
