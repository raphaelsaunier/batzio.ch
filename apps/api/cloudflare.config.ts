import { bindings, defineConfig, defineWorker } from "cf/config";
import { CONTROL_DATABASE_NAME, FILES_BUCKET_NAME, tenantDatabaseSlots } from "@batzio/server/config/tenant-databases";

const tenantDatabases = Object.fromEntries(tenantDatabaseSlots.map((slot) => [slot.binding, bindings.d1({ name: slot.name })]));

export default defineConfig({
  // Set CLOUDFLARE_ACCOUNT_ID in your environment when deploying.
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  worker: defineWorker({
    name: "batzio-api",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-25",
    compatibilityFlags: ["nodejs_compat"],
    env: {
      // Same databases and bucket as the web app: one source of truth.
      DB: bindings.d1({ name: CONTROL_DATABASE_NAME }),
      FILES: bindings.r2({ name: FILES_BUCKET_NAME }),
      ...tenantDatabases,
    },
  }),
});
