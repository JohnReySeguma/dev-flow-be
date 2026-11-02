import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** URL-safe random secret: 32 bytes → 43 characters. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Tokens are stored as SHA-256 hashes, so a database leak does not leak usable tokens. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
