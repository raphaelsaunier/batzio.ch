import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "local",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
