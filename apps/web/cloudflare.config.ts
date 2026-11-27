import { bindings, defineConfig, defineWorker } from "cf/config";
import {
  CONTROL_DATABASE_NAME,
  FILES_BUCKET_NAME,
  PREVIEW_CONTROL_DATABASE_NAME,
  PREVIEW_FILES_BUCKET_NAME,
  previewTenantDatabaseSlots,
  tenantDatabaseSlots,
} from "@batzio/server/config/tenant-databases";

/** Production URL (override with APP_URL for self-hosted deployments). */
const PRODUCTION_URL = process.env.APP_URL || "https://www.batzio.ch";

/**
 * Preview deploys neither create D1 databases nor resolve them by name (a
 * binding without an id is silently dropped), so preview database ids can be
 * provided via environment variables when using `pnpm deploy:preview`.
 */
const PREVIEW_DATABASE_IDS: Record<string, string | undefined> = {
  [PREVIEW_CONTROL_DATABASE_NAME]: process.env.PREVIEW_CONTROL_DB_ID,
  "batzio-preview-tenant-001": process.env.PREVIEW_TENANT_DB_001_ID,
  "batzio-preview-tenant-002": process.env.PREVIEW_TENANT_DB_002_ID,
};

export default defineConfig({
  // Set CLOUDFLARE_ACCOUNT_ID in your environment when deploying.
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  worker: defineWorker(({ isPreview, mode }) => {
    // Previews (`pnpm deploy:preview`) bind their own databases and bucket.
    const preview = isPreview || mode === "preview";
    // Only the production deploy has a fixed public address; dev and previews use the request's host.
    const production = !preview && mode === "production";
    const slots = preview ? previewTenantDatabaseSlots : tenantDatabaseSlots;
    const d1 = (name: string) => {
      const id = preview ? PREVIEW_DATABASE_IDS[name] : undefined;
      return bindings.d1(id ? { name, id } : { name });
    };
    return {
      name: "batzio",
      entrypoint: "./worker/index.ts",
      compatibilityDate: "2026-10-25",
      compatibilityFlags: ["nodejs_compat"],
      assets: {
        htmlHandling: "none",
        notFoundHandling: "none",
        runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
      },
      workersDev: true,
      // Previews (one per branch): <branch>-batzio.<subdomain>.workers.dev and <branch>.batzio.ch.
      previewUrls: true,
      domains: [
        { hostname: "www.batzio.ch", production: true, previews: false },
        { hostname: "batzio.ch", production: false, previews: true },
      ],
      env: {
        ASSETS: bindings.assets(),
        // Control plane: tenants, users, memberships, sessions, API keys.
        DB: d1(preview ? PREVIEW_CONTROL_DATABASE_NAME : CONTROL_DATABASE_NAME),
        // Attachments, receipts and generated documents (keys are prefixed per tenant).
        FILES: bindings.r2({ name: preview ? PREVIEW_FILES_BUCKET_NAME : FILES_BUCKET_NAME }),
        // One isolated database per tenant.
        ...Object.fromEntries(slots.map((slot) => [slot.binding, d1(slot.name)])),
        ...(production ? { APP_URL: { type: "text" as const, value: PRODUCTION_URL } } : {}),
        // The shared demo account on the sign-in page (locally from .dev.vars).
        DEMO_LOGIN_EMAIL: bindings.secret(),
        DEMO_LOGIN_PASSWORD: bindings.secret(),
      },
    };
  }),
});
