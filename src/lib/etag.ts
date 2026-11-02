import { sha256 } from "./crypto.js";

/** An opaque version tag for a row, derived from its id and last update. */
export const versionTag = (id: string, updatedAt: Date) =>
  `"${sha256(`${id}:${updatedAt.toISOString()}`).slice(0, 20)}"`;

/** True when an `If-Match` header (a tag, a comma-separated list or `*`) matches the current tag. */
export function ifMatchSatisfied(header: string, currentTag: string): boolean {
  return header
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag === currentTag);
}
