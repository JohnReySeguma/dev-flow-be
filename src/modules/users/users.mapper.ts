import { createHash } from "node:crypto";
import type { User } from "../../generated/prisma/client.js";
import { AVATAR_GRADIENTS, type UserProfile } from "./users.schemas.js";

/** "John Rey" → "JR", "Aiko" → "A". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** A handle candidate from the email's local part: "Jane.Doe+x@acme.dev" → "janedoex". */
export function handleBase(email: string): string {
  const local = email.split("@")[0] ?? "";
  return (
    local
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 20) || "user"
  );
}

/** Stable per email, so a new account always gets the same colour. */
export function gradientFor(email: string): string {
  const index = createHash("sha256").update(email).digest().readUInt32BE(0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index] ?? AVATAR_GRADIENTS[0];
}

/** Global to the account: roles belong to workspace memberships, not to the profile. */
export function toProfile(user: User): UserProfile {
  return {
    id: user.id,
    name: user.name,
    handle: user.handle,
    initials: initialsOf(user.name),
    gradient: user.gradient,
    email: user.email,
    timezone: user.timezone,
    bio: user.bio,
  };
}
