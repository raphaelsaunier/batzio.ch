import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  // IPv4 loopback: the Android emulator reaches the host as 10.0.2.2 → 127.0.0.1
  // (Node would otherwise bind "localhost" to ::1 only). Browsers and the iOS
  // simulator still use http://localhost:5173.
  server: { host: "127.0.0.1" },
  plugins: [
    tailwindcss(),
    vinext(),
    cloudflare({
      // Local D1/R2 state at the repository root (kept from the single-app layout).
      persistState: { path: "../../.cloudflare/state" },
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  environments: {
    client: {
      // Pre-bundle heavy client dependencies so the dev server does not reload on first use.
      optimizeDeps: {
        include: [
          "recharts",
          "cmdk",
          "sonner",
          "next-themes",
          "radix-ui",
          "@tanstack/react-query",
          "@tanstack/react-query-persist-client",
          "@tanstack/query-async-storage-persister",
          "@tanstack/react-db",
          "@tanstack/query-db-collection",
          "idb-keyval",
        ],
      },
    },
  },
});
