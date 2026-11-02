import { z } from "zod";
import { AppError } from "./errors.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/** `?limit=50&cursor=…` on every list endpoint. */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(200).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Position after a row in a newest-first list ordered by (createdAt, id). */
export type Cursor = { createdAt: Date; id: string };

const cursorShape = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/** Cursors are opaque to clients: base64url JSON of the last row's sort key. */
export const encodeCursor = ({ createdAt, id }: Cursor) =>
  Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");

export function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = cursorShape.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch (error) {
    throw new AppError("VALIDATION_FAILED", "The request contains invalid fields.", {
      errors: [{ field: "cursor", message: "Invalid cursor; use the nextCursor from the previous page." }],
      cause: error,
    });
  }
}

/** Prisma `where` for rows after the cursor in (createdAt desc, id desc) order. */
export function afterCursor(cursor: Cursor) {
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}

/** Prisma `where` for rows after the cursor in (createdAt asc, id asc) order. */
export function afterCursorAsc(cursor: Cursor) {
  return {
    OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }],
  };
}

/** Oldest first, ties broken by id: the order of `afterCursorAsc`. */
export const byCreatedAsc = (a: Cursor, b: Cursor) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Builds a page from rows fetched with `take: limit + 1`: the extra row only signals that
 * another page exists.
 */
export function toPage<Row extends Cursor, T>(rows: Row[], limit: number, map: (row: Row) => T): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items: items.map(map), nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

/** OpenAPI/Zod shape of a page of `item`. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().meta({ description: "Pass as ?cursor= for the next page; null on the last." }),
  });

/** Cursor for lists ordered by a per-project number (sprints): the last number seen, opaque to clients. */
export const encodeNumberCursor = (number: number) => Buffer.from(JSON.stringify({ n: number })).toString("base64url");

const numberCursorShape = z.object({ n: z.number().int().min(0) });

export function decodeNumberCursor(cursor: string): number {
  try {
    return numberCursorShape.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).n;
  } catch (error) {
    throw new AppError("VALIDATION_FAILED", "The request contains invalid fields.", {
      errors: [{ field: "cursor", message: "Invalid cursor; use the nextCursor from the previous page." }],
      cause: error,
    });
  }
}
