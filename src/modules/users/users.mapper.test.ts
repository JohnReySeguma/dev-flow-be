import { describe, expect, it } from "vitest";
import { gradientFor, handleBase, initialsOf } from "./users.mapper.js";
import { AVATAR_GRADIENTS } from "./users.schemas.js";

describe("users mapper", () => {
  it.each([
    ["John Rey", "JR"],
    ["Aiko", "A"],
    ["  mary  ann  smith ", "MS"],
    ["", "?"],
  ])("initials of %j are %j", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });

  it.each([
    ["Jane.Doe+work@acme.dev", "janedoework"],
    ["...@acme.dev", "user"],
    ["averyveryverylonglocalpartname@acme.dev", "averyveryverylongloc"],
  ])("handle base of %j is %j", (email, handle) => {
    expect(handleBase(email)).toBe(handle);
  });

  it("picks a stable gradient from the frontend palette", () => {
    expect(gradientFor("demo@devflow.local")).toBe(gradientFor("demo@devflow.local"));
    expect(AVATAR_GRADIENTS).toContain(gradientFor("demo@devflow.local"));
  });
});
