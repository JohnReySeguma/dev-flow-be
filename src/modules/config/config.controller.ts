import type { RequestHandler } from "express";
import type { ConfigService } from "./config.service.js";

export function createConfigController(service: ConfigService) {
  const get: RequestHandler = (_req, res) => {
    // Fixed for the lifetime of the process, so let clients cache it briefly.
    res.set("Cache-Control", "public, max-age=300").json(service.getPublicConfig());
  };

  return { get };
}
