import { Db } from "./db";
import { createD1Database, D1HttpDatabase } from "./d1-http";
import { migrate } from "./migrate";
import { controlMigrations } from "./migrations/control";
import { tenantMigrations } from "./migrations/tenant";
import type { D1LikeDatabase } from "./types";

export interface TenantDbLocator {
  id: string;
  db_strategy: string;
  db_binding: string | null;
  d1_database_id: string | null;
}

export interface DbEnv {
  DB: D1LikeDatabase;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_D1_TOKEN?: string;
  [binding: string]: unknown;
}

function isD1(value: unknown): value is D1LikeDatabase {
  return !!value && typeof (value as D1LikeDatabase).prepare === "function";
}

/** Tenant database slots are discovered from the bindings (`TENANT_DB_001`, `TENANT_DB_002`, …). */
export function tenantSlotBindings(env: DbEnv): string[] {
  return Object.keys(env)
    .filter((key) => /^TENANT_DB_\d+$/.test(key) && isD1(env[key]))
    .sort();
}

export async function openControlDb(env: DbEnv): Promise<Db> {
  const db = new Db(env.DB);
  await migrate(db, controlMigrations, "control");
  return db;
}

/** Opens (and migrates) the isolated database of a tenant. */
export async function openTenantDb(env: DbEnv, tenant: TenantDbLocator): Promise<Db> {
  let raw: D1LikeDatabase | undefined;
  let cacheKey: string;

  if (tenant.db_strategy === "binding" && tenant.db_binding) {
    const binding = env[tenant.db_binding];
    if (!isD1(binding)) {
      throw new Error(
        `Database binding ${tenant.db_binding} for tenant ${tenant.id} is not configured on this Worker.`,
      );
    }
    raw = binding;
    cacheKey = `binding:${tenant.db_binding}`;
  } else if (tenant.db_strategy === "http" && tenant.d1_database_id) {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_TOKEN) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_TOKEN are required for HTTP tenant databases.");
    }
    raw = new D1HttpDatabase({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_D1_TOKEN,
      databaseId: tenant.d1_database_id,
    });
    cacheKey = `http:${tenant.d1_database_id}`;
  } else {
    throw new Error(`Tenant ${tenant.id} has no database assigned.`);
  }

  const db = new Db(raw);
  await migrate(db, tenantMigrations, cacheKey);
  return db;
}

export interface DatabaseAllocation {
  db_strategy: "binding" | "http";
  db_binding: string | null;
  d1_database_id: string | null;
}

/**
 * Picks a database for a new tenant: the first free binding slot, otherwise a
 * freshly created D1 database reached over the HTTP API.
 */
export async function allocateTenantDatabase(env: DbEnv, control: Db, tenantSlug: string): Promise<DatabaseAllocation> {
  const used = new Set(
    (await control.all<{ db_binding: string }>("SELECT db_binding FROM tenants WHERE db_binding IS NOT NULL")).map(
      (r) => r.db_binding,
    ),
  );
  for (const name of tenantSlotBindings(env)) {
    const binding = env[name];
    if (used.has(name) || !isD1(binding)) continue;
    // Never hand out a slot that already contains company data (e.g. after a failed signup).
    const db = new Db(binding);
    const hasSettings = await db.value<string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'");
    if (hasSettings && (await db.value<number>("SELECT COUNT(*) FROM settings"))) continue;
    return { db_strategy: "binding", db_binding: name, d1_database_id: null };
  }

  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_D1_TOKEN) {
    const id = await createD1Database({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_D1_TOKEN,
      name: `batzio-tenant-${tenantSlug}`,
    });
    return { db_strategy: "http", db_binding: null, d1_database_id: id };
  }

  throw new Error(
    "No tenant database available. Add slots with `pnpm db:slots add 10` and redeploy, " +
      "or configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_TOKEN.",
  );
}

/** Number of unused binding slots, for capacity monitoring. */
export async function freeSlotCount(env: DbEnv, control: Db): Promise<number> {
  const used = await control.all<{ db_binding: string }>("SELECT db_binding FROM tenants WHERE db_binding IS NOT NULL");
  const usedSet = new Set(used.map((r) => r.db_binding));
  return tenantSlotBindings(env).filter((name) => !usedSet.has(name)).length;
}
