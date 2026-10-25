import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  environments: {
    client: {
      // Pre-bundle heavy client dependencies so the dev server does not reload on first use.
      optimizeDeps: { include: ["recharts", "cmdk", "sonner", "next-themes", "radix-ui"] },
    },
  },
});
