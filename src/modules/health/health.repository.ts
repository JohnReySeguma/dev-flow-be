import type { PrismaClient } from "../../lib/prisma.js";
import type { Redis } from "../../lib/redis.js";

export type HealthRepository = {
  pingDatabase: () => Promise<void>;
  /** Null when Redis is not configured. */
  pingRedis: (() => Promise<void>) | null;
};

export function createHealthRepository(prisma: PrismaClient, redis: Redis | null): HealthRepository {
  return {
    pingDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    pingRedis: redis
      ? async () => {
          await redis.ping();
        }
      : null,
  };
}
