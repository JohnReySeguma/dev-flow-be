import { describe, expect, it } from "vitest";
import { ifMatchSatisfied, versionTag } from "./etag.js";

const tag = versionTag("0193f1c2-0000-7000-8000-000000000001", new Date("2026-11-01T09:00:00.000Z"));

describe("etag", () => {
  it("changes when the row changes", () => {
    expect(tag).toMatch(/^"[0-9a-f]{20}"$/);
    expect(versionTag("0193f1c2-0000-7000-8000-000000000001", new Date("2026-11-01T09:00:00.001Z"))).not.toBe(tag);
  });

  it.each([
    [tag, true],
    [`"other", ${tag}`, true],
    ["*", true],
    ['"other"', false],
    [`W/${tag}`, false],
  ])("If-Match %j matches: %s", (header, expected) => {
    expect(ifMatchSatisfied(header, tag)).toBe(expected);
  });
});
