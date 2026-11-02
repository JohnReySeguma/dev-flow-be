import { describe, expect, it } from "vitest";
import { burndown, type IssueState } from "./burndown.js";

const DAY = 86_400_000;
const start = new Date("2026-11-02T09:00:00.000Z");
const day = (n: number, hours = 0) => new Date(start.getTime() + n * DAY + hours * 3_600_000);
const sprint = { id: "s1", startAt: start, endAt: day(4), completedAt: null, committedPoints: 10 };

const state = (issueId: string, at: Date, patch: Partial<IssueState> = {}): IssueState => ({
  issueId,
  at,
  sprintId: "s1",
  estimate: 5,
  done: false,
  ...patch,
});

describe("burndown", () => {
  it("draws one point per sprint day with a straight ideal line", () => {
    const days = burndown(sprint, [], day(10));

    expect(days.map((d) => d.ideal)).toEqual([10, 7.5, 5, 2.5, 0]);
    expect(days[0]?.date).toBe("2026-11-02T09:00:00.000Z");
  });

  it("burns points down as issues are done", () => {
    const events = [state("a", start), state("b", start), state("a", day(1, 3), { done: true })];

    expect(burndown(sprint, events, day(10)).map((d) => d.remaining)).toEqual([10, 10, 5, 5, 5]);
  });

  it("counts scope added mid-sprint and issues moved out", () => {
    const events = [
      state("a", start),
      state("b", day(1, 2), { estimate: 3 }),
      state("a", day(2, 1), { sprintId: null }),
    ];

    expect(burndown(sprint, events, day(10)).map((d) => d.remaining)).toEqual([5, 5, 8, 3, 3]);
  });

  it("follows estimate changes", () => {
    const events = [state("a", start), state("a", day(0, 5), { estimate: 8 })];

    expect(burndown(sprint, events, day(10))[1]?.remaining).toBe(8);
  });

  it("leaves days that have not happened yet empty, with half a day of tolerance", () => {
    const remaining = burndown(sprint, [state("a", start)], day(1, 14)).map((d) => d.remaining);

    expect(remaining).toEqual([5, 5, 5, null, null]);
  });

  it("reads a completed sprint just before it completed, so the carry-over is not burned down", () => {
    const completedAt = day(3);
    const events = [state("a", start), state("a", completedAt, { sprintId: null })];

    const days = burndown({ ...sprint, completedAt }, events, day(10));

    expect(days.map((d) => d.remaining)).toEqual([5, 5, 5, 5, 5]);
  });

  it("uses the open points at the start when no commitment was recorded", () => {
    const days = burndown({ ...sprint, committedPoints: null }, [state("a", start), state("b", start)], day(10));

    expect(days[0]?.ideal).toBe(10);
  });
});
