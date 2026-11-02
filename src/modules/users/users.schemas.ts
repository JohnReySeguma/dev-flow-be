import { z } from "zod";

/** Avatar gradients the frontend offers (lib/account-data.ts AVATAR_GRADIENTS). */
export const AVATAR_GRADIENTS = [
  "from-violet-500 to-indigo-600",
  "from-rose-500 to-orange-500",
  "from-sky-500 to-cyan-500",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-yellow-600",
  "from-fuchsia-500 to-pink-600",
] as const;

export const roleSchema = z.enum(["admin", "member", "viewer"]);

/** The frontend's `UserProfile` (lib/account-data.ts), minus `presence`, which arrives with realtime. */
export const userProfile = z
  .object({
    id: z.uuid(),
    name: z.string(),
    handle: z.string(),
    initials: z.string(),
    gradient: z.string(),
    email: z.email(),
    role: roleSchema,
    timezone: z.string(),
    bio: z.string(),
  })
  .meta({
    id: "UserProfile",
    example: {
      id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e01",
      name: "John Rey",
      handle: "jrey",
      initials: "JR",
      gradient: "from-violet-500 to-indigo-600",
      email: "demo@devflow.local",
      role: "admin",
      timezone: "America/New_York",
      bio: "Frontend platform lead. Owns the board, realtime sync and the design system.",
    },
  });

export type UserProfile = z.infer<typeof userProfile>;
