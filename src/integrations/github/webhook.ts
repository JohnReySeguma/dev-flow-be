import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies GitHub's X-Hub-Signature-256 header (`sha256=<hex HMAC of the raw body>`) in constant
 * time. The raw bytes matter: re-serialised JSON would not match.
 */
export function verifySignature(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export type IssueRef = { projectKey: string; number: number };

const ISSUE_KEY = /\b([A-Za-z]{2,5})-(\d{1,9})\b/g;

/**
 * Issue keys mentioned in branch names, PR titles or commit messages: "DEV-104", "dev-104-fix",
 * "Fix BIL-41 and DEV-088". Unique, upper-cased; candidates that are not real issues (such as
 * "UTF-8") are dropped later, when they are looked up.
 */
export function extractIssueRefs(...texts: (string | null | undefined)[]): IssueRef[] {
  const refs = new Map<string, IssueRef>();
  for (const text of texts) {
    for (const match of text?.matchAll(ISSUE_KEY) ?? []) {
      const projectKey = (match[1] ?? "").toUpperCase();
      const number = Number(match[2]);
      refs.set(`${projectKey}-${number}`, { projectKey, number });
    }
  }
  return [...refs.values()];
}

/** The branch name in a push's `ref` ("refs/heads/dev-104-fix" → "dev-104-fix"). */
export const branchOf = (ref: string | undefined) => ref?.replace(/^refs\/heads\//, "");
