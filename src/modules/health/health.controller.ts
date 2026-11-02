import type { RequestHandler } from "express";
import type { HealthService } from "./health.service.js";

export function createHealthController(service: HealthService) {
  const live: RequestHandler = (_req, res) => {
    res.set("Cache-Control", "no-store").json(service.liveness());
  };

  const ready: RequestHandler = async (_req, res) => {
    const readiness = await service.readiness();
    res
      .status(readiness.status === "ok" ? 200 : 503)
      .set("Cache-Control", "no-store")
      .json(readiness);
  };

  return { live, ready };
}
