import type { Lang } from "@batzio/core/swiss/chart-of-accounts";
import { audit } from "./audit";
import { insertTenant, slugify, type TenantRow, type UserRow } from "./control";
import { systemCtx, type Ctx } from "./ctx";
import { allocateTenantDatabase, openTenantDb, type DbEnv } from "./db/connections";
import type { Db } from "./db/db";
import type { R2LikeBucket } from "./db/types";
import { seedDemo, seedTenant } from "./seed";

export interface CreateCompanyInput {
  name: string;
  slug?: string;
  language: Lang;
  demo?: boolean;
}

/** Provisions a company: allocates an isolated D1 database, migrates and seeds it. */
export async function createCompany(
  env: DbEnv & { FILES?: unknown },
  control: Db,
  owner: UserRow,
  input: CreateCompanyInput,
): Promise<TenantRow> {
  const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name);
  const allocation = await allocateTenantDatabase(env, control, slug);
  const tenant = await insertTenant(control, {
    slug,
    name: input.name.trim(),
    locale: `${input.language}-CH`,
    ownerId: owner.id,
    allocation,
  });
  try {
    const db = await openTenantDb(env, tenant);
    const ctx: Ctx = {
      ...systemCtx({
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, locale: tenant.locale },
        db,
        control,
        files: env.FILES as R2LikeBucket | undefined,
      }),
      user: { id: owner.id, name: owner.name, email: owner.email },
      actor: { type: "user", id: owner.id, name: owner.name, source: "ui" },
    };
    await seedTenant(ctx, { name: tenant.name, language: input.language });
    await audit(ctx, { action: "create_company", resource: "company", summary: `Company ${tenant.name} created` });
    if (input.demo) await seedDemo(ctx);
  } catch (error) {
    // Release the tenant record; the half-initialised slot is skipped by future allocations.
    await control.run("DELETE FROM tenants WHERE id = ?", tenant.id);
    throw error;
  }
  return tenant;
}
