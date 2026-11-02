import { Router } from "express";
import type { PrismaClient } from "../../lib/prisma.js";
import type { Redis } from "../../lib/redis.js";
import { createHealthController } from "./health.controller.js";
import { createHealthRepository } from "./health.repository.js";
import { createHealthService } from "./health.service.js";

/** Unauthenticated probes for Docker, load balancers and uptime checks. */
export function createHealthRouter(deps: { prisma: PrismaClient; redis: Redis | null }): Router {
  const controller = createHealthController(createHealthService(createHealthRepository(deps.prisma, deps.redis)));

  const router = Router();
  router.get("/", controller.live);
  router.get("/ready", controller.ready);
  return router;
}
