import { AppError } from "../../lib/errors.js";
import { ifMatchSatisfied, versionTag } from "../../lib/etag.js";
import { toProfile } from "./users.mapper.js";
import type { UsersRepository } from "./users.repository.js";
import type { UpdateProfileInput, UserProfile } from "./users.schemas.js";

export type VersionedProfile = { profile: UserProfile; etag: string };

const stale = () => new AppError("CONFLICT_STALE", "Your profile changed since it was loaded. Reload and try again.");

export function createUsersService(users: UsersRepository) {
  /** v1 profiles carry the role in the user's only workspace. */
  const roleOf = async (userId: string) => (await users.primaryMembership(userId))?.role ?? "viewer";

  return {
    async getProfile(userId: string): Promise<VersionedProfile> {
      const user = await users.findById(userId);
      if (!user) throw new AppError("NOT_FOUND", "User not found.");
      return { profile: toProfile(user, await roleOf(userId)), etag: versionTag(user.id, user.updatedAt) };
    },

    /** With `ifMatch`, rejects the change (412) if the profile changed since the client read it. */
    async updateProfile(userId: string, input: UpdateProfileInput, ifMatch?: string): Promise<VersionedProfile> {
      const current = await users.findById(userId);
      if (!current) throw new AppError("NOT_FOUND", "User not found.");
      if (ifMatch !== undefined && !ifMatchSatisfied(ifMatch, versionTag(current.id, current.updatedAt))) throw stale();

      const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const updated = await users.updateProfile(userId, data, ifMatch === undefined ? undefined : current.updatedAt);
      if (!updated) throw stale();
      return { profile: toProfile(updated, await roleOf(userId)), etag: versionTag(updated.id, updated.updatedAt) };
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
