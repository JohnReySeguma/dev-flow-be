import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"] } },
      {
        // Supertest against the real devflow_test database; files share it, so run them one at a time.
        test: {
          name: "integration",
          include: ["tests/**/*.test.ts"],
          globalSetup: ["tests/global-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
