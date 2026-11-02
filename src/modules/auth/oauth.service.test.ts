import { describe, expect, it } from "vitest";
import { safeRedirect } from "./oauth.service.js";

describe("safeRedirect", () => {
  it.each(["/projects", "/projects/DEV/board?sprint=active", "/"])("keeps the relative path %j", (path) => {
    expect(safeRedirect(path)).toBe(path);
  });

  it.each([
    undefined,
    ["/projects"],
    "projects",
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "/projects\r\nSet-Cookie: x",
    `/${"a".repeat(600)}`,
  ])("falls back to /projects for %j", (value) => {
    expect(safeRedirect(value)).toBe("/projects");
  });
});
