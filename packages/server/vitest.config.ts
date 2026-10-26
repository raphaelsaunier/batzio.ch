import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "cloudflare:workers": fileURLToPath(new URL("./tests/helpers/workers-env.ts", import.meta.url)) },
  },
  test: {
    name: "server",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
