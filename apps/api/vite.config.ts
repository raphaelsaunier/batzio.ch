import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Locally this Worker keeps its own D1/R2 state; deployed, it binds the same
// databases and bucket as the web app (by name). The native apps use the web
// dev server's identical /api routes during development.
export default defineConfig({
  plugins: [cloudflare()],
});
