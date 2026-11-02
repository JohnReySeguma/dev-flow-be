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
    timezone: z.string(),
    bio: z.string(),
    isDemo: z.boolean().meta({
      description:
        "A shared demo account (public password): profile edits, access tokens and creating workspaces are locked.",
    }),
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
      timezone: "America/New_York",
      bio: "Frontend platform lead. Owns the board, realtime sync and the design system.",
      isDemo: true,
    },
  });

export type UserProfile = z.infer<typeof userProfile>;

const TIMEZONES = new Set([...Intl.supportedValuesOf("timeZone"), "UTC"]);

export const updateProfileBody = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(48, "Use at most 48 characters."),
    gradient: z.enum(AVATAR_GRADIENTS, { error: "Pick one of the offered avatar colours." }),
    timezone: z.string().refine((value) => TIMEZONES.has(value), "Pick a valid IANA timezone, e.g. Asia/Manila."),
    bio: z.string().trim().max(280, "Use at most 280 characters."),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Send at least one of name, gradient, timezone or bio.")
  .meta({
    id: "UpdateProfileRequest",
    description: "Only these fields can change; email and handle cannot.",
    example: { timezone: "Asia/Manila", bio: "Owns the board and realtime sync." },
  });

export type UpdateProfileInput = z.infer<typeof updateProfileBody>;
