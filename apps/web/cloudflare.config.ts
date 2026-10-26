import { bindings, defineConfig, defineWorker } from "cf/config";
import {
  CONTROL_DATABASE_NAME,
  FILES_BUCKET_NAME,
  PREVIEW_CONTROL_DATABASE_NAME,
  PREVIEW_FILES_BUCKET_NAME,
  previewTenantDatabaseSlots,
  tenantDatabaseSlots,
} from "@batzio/server/config/tenant-databases";

/** Production lives on www.batzio.ch (the apex redirects there with a zone rule). */
const PRODUCTION_URL = "https://www.batzio.ch";

/**
 * Preview deploys neither create D1 databases nor resolve them by name (a
 * binding without an id is silently dropped), so the preview databases are
 * pinned by id. Create new ones with `cf d1 create <name>` and add them here.
 */
const PREVIEW_DATABASE_IDS: Record<string, string> = {
  [PREVIEW_CONTROL_DATABASE_NAME]: "6b4cf66f-6535-4ce2-be59-c0aa2bf44d71",
  "batzio-preview-tenant-001": "f163ba13-332d-43e2-95bd-02604ee38b23",
  "batzio-preview-tenant-002": "bc486a0f-502c-4279-aca8-0ecdad02bc5a",
};

export default defineConfig({
  // Personal account (also settable through CLOUDFLARE_ACCOUNT_ID).
  accountId: "f0a2e7131fd38eedc63c8c42eb086189",
  worker: defineWorker(({ isPreview, mode }) => {
    // Previews (`pnpm deploy:preview`) bind their own databases and bucket.
    const preview = isPreview || mode === "preview";
    // Only the production deploy has a fixed public address; dev and previews use the request's host.
    const production = !preview && mode === "production";
    const slots = preview ? previewTenantDatabaseSlots : tenantDatabaseSlots;
    const d1 = (name: string) => bindings.d1(preview ? { name, id: PREVIEW_DATABASE_IDS[name] } : { name });
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
