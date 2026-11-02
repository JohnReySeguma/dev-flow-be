import type { RequestHandler } from "express";
import { authOf } from "../../middleware/require-auth.js";
import type { UpdateProfileInput } from "./users.schemas.js";
import type { UsersService } from "./users.service.js";

export function createUsersController(users: UsersService) {
  const getMe: RequestHandler = async (req, res) => {
    const { profile, etag } = await users.getProfile(authOf(req).userId);
    res.set({ ETag: etag, "Cache-Control": "no-store" }).json(profile);
  };

  const updateMe: RequestHandler = async (req, res) => {
    const { profile, etag } = await users.updateProfile(
      authOf(req).userId,
      req.body as UpdateProfileInput,
      req.get("if-match"),
    );
    res.set("ETag", etag).json(profile);
  };

  return { getMe, updateMe };
}
