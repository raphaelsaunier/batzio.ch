import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    // `pnpm test:coverage` (CI) fails when coverage of the engine drops below these.
    coverage: {
      provider: "v8",
      include: ["packages/server/src/**/*.ts", "packages/core/src/**/*.ts", "packages/i18n/src/**/*.ts"],
      reporter: ["text-summary"],
      thresholds: { statements: 77, branches: 61, functions: 80, lines: 81 },
    },
  },
});
