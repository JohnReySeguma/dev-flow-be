import { randomInt } from "node:crypto";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_BASE_LENGTH = 40;
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** "Acme Inc." → "acme-inc", "Café Ünïcode" → "cafe-unicode"; never empty. Same rule as the migration. */
export function slugBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

/** The base with a short random suffix, for when the base is taken: "acme-inc-x7k2". */
export function slugWithSuffix(base: string): string {
  const suffix = Array.from({ length: 4 }, () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]).join("");
  return `${base}-${suffix}`;
}
