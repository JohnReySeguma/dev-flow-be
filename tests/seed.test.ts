import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_WORKSPACE_NAME, seed } from "../prisma/seed.js";
import { createLogger } from "../src/lib/logger.js";
import { createPrismaClient } from "../src/lib/prisma.js";
import { truncateAll } from "./helpers/db.js";
import { testEnv } from "./helpers/env.js";

const env = testEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const logger = createLogger(env);

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

describe("seed", () => {
  it("creates the demo workspace in an empty database", async () => {
    expect(await seed(prisma, logger)).toBe(true);

    expect(await prisma.workspace.findMany({ select: { name: true } })).toEqual([{ name: DEMO_WORKSPACE_NAME }]);
  });

  it("leaves a database that already has data untouched", async () => {
    await seed(prisma, logger);

    expect(await seed(prisma, logger)).toBe(false);
    expect(await prisma.workspace.count()).toBe(1);
  });
});
