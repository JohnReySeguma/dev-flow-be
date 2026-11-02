import { z } from "zod";

export const livenessResponse = z
  .object({ status: z.literal("ok") })
  .meta({ id: "Liveness", example: { status: "ok" } });

export const readinessResponse = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    checks: z.object({
      database: z.enum(["up", "down"]),
      redis: z.enum(["up", "down", "disabled"]).meta({ description: "`disabled` when REDIS_URL is not set." }),
    }),
  })
  .meta({ id: "Readiness", example: { status: "ok", checks: { database: "up", redis: "up" } } });

export type Liveness = z.infer<typeof livenessResponse>;
export type Readiness = z.infer<typeof readinessResponse>;
