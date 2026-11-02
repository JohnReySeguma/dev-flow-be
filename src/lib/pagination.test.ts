import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, paginationQuery, toPage } from "./pagination.js";

const row = (n: number) => ({
  id: `0193f1c2-0000-7000-8000-00000000000${n}`,
  createdAt: new Date(Date.UTC(2026, 10, 1, 9, 0, 10 - n)),
});

describe("pagination", () => {
  it("round-trips a cursor", () => {
    const cursor = row(1);

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects a tampered cursor as a validation error on `cursor`", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED", errors: [expect.objectContaining({ field: "cursor" })] }),
    );
  });

  it("returns a next cursor only when an extra row was fetched", () => {
    const rows = [row(1), row(2), row(3)];

    const first = toPage(rows, 2, (r) => r.id);
    const last = toPage(rows.slice(0, 2), 2, (r) => r.id);

    expect(first.items).toEqual([row(1).id, row(2).id]);
    expect(first.nextCursor && decodeCursor(first.nextCursor)).toEqual(row(2));
    expect(last.nextCursor).toBeNull();
  });

  it("defaults and bounds the limit", () => {
    expect(paginationQuery.parse({})).toEqual({ limit: 50 });
    expect(paginationQuery.safeParse({ limit: "101" }).success).toBe(false);
  });
});
