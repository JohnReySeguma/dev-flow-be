import { Router, type Request, type RequestHandler } from "express";
import { requireScope } from "../../middleware/permissions.js";
import { authOf } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import { historyQuery, velocityQuery, type HistoryQuery, type VelocityQuery } from "./reports.schemas.js";
import type { ReportsService } from "./reports.service.js";

// validate({ query }) has already replaced req.query with the parsed value.
const velocityQueryOf = (req: Request) => req.query as unknown as VelocityQuery;
const historyQueryOf = (req: Request) => req.query as unknown as HistoryQuery;

/** Any role reads reports; tokens need issues:read. */
function createReportsController(reports: ReportsService) {
  const burndown: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await reports.burndown(authOf(req), String(req.params.id)));
  };
  const velocity: RequestHandler = async (req, res) => {
    const { limit } = velocityQueryOf(req);
    res.set("Cache-Control", "no-store").json(await reports.velocity(authOf(req), String(req.params.key), limit));
  };
  const history: RequestHandler = async (req, res) => {
    res
      .set("Cache-Control", "no-store")
      .json(await reports.history(authOf(req), String(req.params.key), historyQueryOf(req)));
  };
  return { burndown, velocity, history };
}

/** Mounted at /sprints/:id/burndown. */
export function createBurndownRouter(deps: { reports: ReportsService; requireAuth: RequestHandler }): Router {
  const controller = createReportsController(deps.reports);
  const router = Router({ mergeParams: true });
  router.get("/", deps.requireAuth, requireScope("issues:read"), controller.burndown);
  return router;
}

/** Mounted at /projects/:key/reports. */
export function createProjectReportsRouter(deps: { reports: ReportsService; requireAuth: RequestHandler }): Router {
  const controller = createReportsController(deps.reports);
  const router = Router({ mergeParams: true });
  router.use(deps.requireAuth, requireScope("issues:read"));
  router.get("/velocity", validate({ query: velocityQuery }), controller.velocity);
  router.get("/history", validate({ query: historyQuery }), controller.history);
  return router;
}
