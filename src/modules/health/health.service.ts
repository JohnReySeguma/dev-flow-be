import type { HealthRepository } from "./health.repository.js";
import type { Liveness, Readiness } from "./health.schemas.js";

/** A probe slower than this counts as down, so readiness answers before a load balancer gives up. */
export const PROBE_TIMEOUT_MS = 2000;

async function probe(ping: () => Promise<void>, timeoutMs: number): Promise<"up" | "down"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("probe timed out"));
    }, timeoutMs);
  });
  try {
    await Promise.race([ping(), timeout]);
    return "up";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthService(repository: HealthRepository, timeoutMs = PROBE_TIMEOUT_MS) {
  return {
    liveness: (): Liveness => ({ status: "ok" }),

    async readiness(): Promise<Readiness> {
      const [database, redis] = await Promise.all([
        probe(repository.pingDatabase, timeoutMs),
        repository.pingRedis ? probe(repository.pingRedis, timeoutMs) : ("disabled" as const),
      ]);
      const ready = database === "up" && redis !== "down";
      return { status: ready ? "ok" : "unavailable", checks: { database, redis } };
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
