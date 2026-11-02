import { z } from "zod";
import { pageOf } from "../../lib/pagination.js";

export const comment = z
  .object({
    id: z.uuid(),
    issueKey: z.string(),
    author: z
      .object({ id: z.uuid(), name: z.string(), initials: z.string(), gradient: z.string() })
      .nullable()
      .meta({ description: "Null when the author has left the workspace." }),
    body: z.string().meta({ description: "Markdown; sanitise when rendering." }),
    createdAt: z.iso.datetime(),
  })
  .meta({
    id: "Comment",
    example: {
      id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e40",
      issueKey: "DEV-104",
      author: {
        id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e02",
        name: "Aiko Mori",
        initials: "AM",
        gradient: "from-rose-500 to-orange-500",
      },
      body: "Reproduced with two tabs open; the second refresh revokes the session.",
      createdAt: "2026-10-31T14:20:00.000Z",
    },
  });

export const commentPage = pageOf(comment).meta({
  id: "CommentPage",
  example: { items: [comment.meta()?.example], nextCursor: null },
});

export const createCommentBody = z
  .object({ body: z.string().trim().min(1, "Write a comment.").max(10_000, "Use at most 10,000 characters.") })
  .meta({ id: "CreateCommentRequest", example: { body: "Looks good to me. Merging after CI." } });

export type CommentView = z.infer<typeof comment>;
export type CreateCommentInput = z.infer<typeof createCommentBody>;
