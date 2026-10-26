/**
 * Pool of per-tenant D1 databases.
 *
 * Every company (tenant) in Batzio gets its own isolated D1 database. Workers can
 * only talk to D1 databases they are bound to, so we pre-declare a pool of
 * database "slots". When a new company is created it claims the next free slot.
 *
 * - Locally, Miniflare simulates every slot as its own SQLite file.
 * - On deploy, `cf` provisions any database in this list that does not exist yet.
 * - Run `pnpm db:slots add <count>` to grow the pool before it runs out, then deploy.
 *
 * Tenants can also be served over the D1 HTTP API (see lib/server/db/d1-http.ts)
 * when the pool is exhausted and CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_TOKEN are set.
 */
export interface TenantDatabaseSlot {
  /** Binding name exposed on `env` (must be a valid JS identifier). */
  binding: string;
  /** D1 database name in the Cloudflare account. */
  name: string;
}

export const CONTROL_DATABASE_NAME = "batzio-control";
export const FILES_BUCKET_NAME = "batzio-files";

export const tenantDatabaseSlots: TenantDatabaseSlot[] = [
  { binding: "TENANT_DB_001", name: "batzio-tenant-001" },
  { binding: "TENANT_DB_002", name: "batzio-tenant-002" },
  { binding: "TENANT_DB_003", name: "batzio-tenant-003" },
  { binding: "TENANT_DB_004", name: "batzio-tenant-004" },
  { binding: "TENANT_DB_005", name: "batzio-tenant-005" },
  { binding: "TENANT_DB_006", name: "batzio-tenant-006" },
  { binding: "TENANT_DB_007", name: "batzio-tenant-007" },
  { binding: "TENANT_DB_008", name: "batzio-tenant-008" },
];

/**
 * Previews (branch deployments) bind their own control database, bucket and a
 * small pool of tenant slots under the same binding names: they never see
 * production data.
 */
export const PREVIEW_CONTROL_DATABASE_NAME = "batzio-preview-control";
export const PREVIEW_FILES_BUCKET_NAME = "batzio-preview-files";
export const previewTenantDatabaseSlots: TenantDatabaseSlot[] = tenantDatabaseSlots
  .slice(0, 2)
  .map((slot) => ({ binding: slot.binding, name: slot.name.replace("batzio-tenant-", "batzio-preview-tenant-") }));
