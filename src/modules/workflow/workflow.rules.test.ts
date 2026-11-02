import { describe, expect, it } from "vitest";
import { cannotDeleteStatusReason, cannotRecategoriseReason, insertionIndex } from "./workflow.rules.js";

const workflow = [
  { id: "todo", category: "todo" as const },
  { id: "progress", category: "in_progress" as const },
  { id: "review", category: "in_progress" as const },
  { id: "done", category: "done" as const },
];

describe("cannotDeleteStatusReason", () => {
  it.each([
    ["todo", "Keep at least one To do status so new issues have somewhere to start."],
    ["done", "Keep at least one Done status so sprints can be completed."],
    ["progress", null],
    ["missing", "Status not found."],
  ])("%s → %j", (id, reason) => {
    expect(cannotDeleteStatusReason(workflow, id)).toBe(reason);
  });

  it("keeps at least two statuses", () => {
    expect(cannotDeleteStatusReason(workflow.slice(0, 2), "progress")).toBe("A workflow needs at least two statuses.");
  });

  it("allows deleting one of several done statuses", () => {
    expect(cannotDeleteStatusReason([...workflow, { id: "released", category: "done" }], "done")).toBeNull();
  });
});

describe("cannotRecategoriseReason", () => {
  it("blocks turning the only to-do or done status into something else", () => {
    expect(cannotRecategoriseReason(workflow, "todo", "in_progress")).toMatch(/To do/);
    expect(cannotRecategoriseReason(workflow, "done", "todo")).toMatch(/Done/);
  });

  it("allows in-progress statuses and unchanged categories", () => {
    expect(cannotRecategoriseReason(workflow, "review", "done")).toBeNull();
    expect(cannotRecategoriseReason(workflow, "todo", "todo")).toBeNull();
  });
});

describe("insertionIndex", () => {
  it("inserts before the first done status unless the new status is done", () => {
    expect(insertionIndex(workflow, "in_progress")).toBe(3);
    expect(insertionIndex(workflow, "todo")).toBe(3);
    expect(insertionIndex(workflow, "done")).toBe(4);
  });
});
