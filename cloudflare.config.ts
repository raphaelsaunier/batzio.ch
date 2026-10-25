import { bindings, defineConfig, defineWorker } from "cf/config";
import {
  CONTROL_DATABASE_NAME,
  FILES_BUCKET_NAME,
  tenantDatabaseSlots,
} from "./config/tenant-databases.ts";

const tenantDatabases = Object.fromEntries(
  tenantDatabaseSlots.map((slot) => [slot.binding, bindings.d1({ name: slot.name })]),
);

export default defineConfig({
  worker: defineWorker({
    name: "batzio",
    entrypoint: "./worker/index.ts",
    compatibilityDate: "2026-10-25",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      // Control plane: tenants, users, memberships, sessions, API keys.
      DB: bindings.d1({ name: CONTROL_DATABASE_NAME }),
      // Attachments, receipts and generated documents (keys are prefixed per tenant).
      FILES: bindings.r2({ name: FILES_BUCKET_NAME }),
      // One isolated database per tenant.
      ...tenantDatabases,
    },
  }),
});
