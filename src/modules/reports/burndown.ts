const DAY = 24 * 60 * 60 * 1000;

/** An issue's state after a recorded change (issue_events). */
export type IssueState = { issueId: string; sprintId: string | null; estimate: number | null; done: boolean; at: Date };

export type BurndownSprint = {
  id: string;
  startAt: Date;
  endAt: Date;
  completedAt: Date | null;
  committedPoints: number | null;
};

export type BurndownDay = { date: string; ideal: number; remaining: number | null };

/** Points still open in the sprint at `time`, replaying each issue's latest state up to then. */
function remainingAt(history: Map<string, IssueState[]>, sprintId: string, time: number): number {
  let remaining = 0;
  for (const states of history.values()) {
    let latest: IssueState | undefined;
    for (const state of states) {
      if (state.at.getTime() > time) break;
      latest = state;
    }
    if (latest?.sprintId === sprintId && !latest.done) remaining += latest.estimate ?? 0;
  }
  return remaining;
}

/**
 * One point per sprint day, as the frontend's reports view draws it: `ideal` falls in a straight
 * line from the committed points to zero; `remaining` is what was still open at that moment,
 * from the issue history, and null for days that have not happened yet (with the frontend's
 * half-day tolerance). A completed sprint is read just before it completed, so the carry-over
 * itself does not look like burned-down work.
 */
export function burndown(sprint: BurndownSprint, events: IssueState[], now: Date): BurndownDay[] {
  const start = sprint.startAt.getTime();
  const length = Math.max(1, Math.round((sprint.endAt.getTime() - start) / DAY));
  const cutoff = sprint.completedAt ? sprint.completedAt.getTime() - 1 : now.getTime();

  const history = new Map<string, IssueState[]>();
  for (const event of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const states = history.get(event.issueId) ?? [];
    states.push(event);
    history.set(event.issueId, states);
  }
  const committed = sprint.committedPoints ?? remainingAt(history, sprint.id, start);

  return Array.from({ length: length + 1 }, (_, day) => {
    const at = start + day * DAY;
    const visible = sprint.completedAt !== null || at <= now.getTime() + DAY / 2;
    return {
      date: new Date(at).toISOString(),
      ideal: Math.round(committed * (1 - day / length) * 100) / 100,
      remaining: visible ? remainingAt(history, sprint.id, Math.min(at, cutoff)) : null,
    };
  });
}
