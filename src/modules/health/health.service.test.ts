import { describe, expect, it } from "vitest";
import type { HealthRepository } from "./health.repository.js";
import { createHealthService } from "./health.service.js";

const up = () => Promise.resolve();
const down = () => Promise.reject(new Error("ECONNREFUSED"));
const hang = () => new Promise<void>(() => undefined);

function service(repository: HealthRepository) {
  return createHealthService(repository, 50);
}

describe("health service", () => {
  it("is ready when every configured dependency is up", async () => {
    expect(await service({ pingDatabase: up, pingRedis: up }).readiness()).toEqual({
      status: "ok",
      checks: { database: "up", redis: "up" },
    });
  });

  it("reports redis as disabled, not down, when it is not configured", async () => {
    expect(await service({ pingDatabase: up, pingRedis: null }).readiness()).toEqual({
      status: "ok",
      checks: { database: "up", redis: "disabled" },
    });
  });

  it("is unavailable when the database is down", async () => {
    const readiness = await service({ pingDatabase: down, pingRedis: up }).readiness();

    expect(readiness).toEqual({ status: "unavailable", checks: { database: "down", redis: "up" } });
  });

  it("is unavailable when configured redis is down", async () => {
    expect((await service({ pingDatabase: up, pingRedis: down }).readiness()).status).toBe("unavailable");
  });

  it("treats a hanging probe as down", async () => {
    const readiness = await service({ pingDatabase: hang, pingRedis: null }).readiness();

    expect(readiness.checks.database).toBe("down");
  });
});
