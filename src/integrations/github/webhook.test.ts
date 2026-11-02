import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { branchOf, extractIssueRefs, verifySignature } from "./webhook.js";

const secret = "whsec_test";
const body = Buffer.from('{"zen":"Keep it logically awesome."}');
const sign = (raw: Buffer, key = secret) => `sha256=${createHmac("sha256", key).update(raw).digest("hex")}`;

describe("verifySignature", () => {
  it("accepts GitHub's signature of the raw body", () => {
    expect(verifySignature(secret, body, sign(body))).toBe(true);
  });

  it.each([
    ["a missing header", undefined],
    ["the old SHA-1 header format", "sha1=abc"],
    ["another secret", sign(body, "other")],
    ["a re-serialised body", sign(Buffer.from('{"zen": "Keep it logically awesome."}'))],
  ])("rejects %s", (_, header) => {
    expect(verifySignature(secret, body, header)).toBe(false);
  });
});

describe("extractIssueRefs", () => {
  it("finds keys in branch names, titles and messages, unique and upper-cased", () => {
    expect(
      extractIssueRefs("feature/dev-104-token-refresh", "Fix DEV-104 and BIL-41", "BIL-41: idempotency keys"),
    ).toEqual([
      { projectKey: "DEV", number: 104 },
      { projectKey: "BIL", number: 41 },
    ]);
  });

  it("normalises zero-padded numbers", () => {
    expect(extractIssueRefs("DEV-088")).toEqual([{ projectKey: "DEV", number: 88 }]);
  });

  it("ignores text without keys", () => {
    expect(extractIssueRefs("main", undefined, "Bump deps")).toEqual([]);
  });
});

describe("branchOf", () => {
  it("strips refs/heads/", () => {
    expect(branchOf("refs/heads/dev-104-fix")).toBe("dev-104-fix");
  });
});
