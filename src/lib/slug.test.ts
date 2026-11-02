import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, slugBase, slugWithSuffix } from "./slug.js";

describe("slug", () => {
  it.each([
    ["Acme Inc", "acme-inc"],
    ["  Acme   Inc. ", "acme-inc"],
    ["John Rey's workspace", "john-reys-workspace"],
    ["Ada’s team", "adas-team"],
    ["Café Ünïcode", "cafe-unicode"],
    ["日本語", "workspace"],
    ["---", "workspace"],
  ])("%j → %j", (name, slug) => {
    expect(slugBase(name)).toBe(slug);
    expect(slugBase(name)).toMatch(SLUG_PATTERN);
  });

  it("keeps long names to 40 characters without a trailing dash", () => {
    const slug = slugBase(`${"a".repeat(39)} b`);

    expect(slug).toBe("a".repeat(39));
  });

  it("adds a four-character suffix", () => {
    expect(slugWithSuffix("acme-inc")).toMatch(/^acme-inc-[a-z0-9]{4}$/);
  });
});
