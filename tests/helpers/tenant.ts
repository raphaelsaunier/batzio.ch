import { Db } from "@/lib/server/db/db";
import { migrate } from "@/lib/server/db/migrate";
import { controlMigrations } from "@/lib/server/db/migrations/control";
import { tenantMigrations } from "@/lib/server/db/migrations/tenant";
import type { Ctx } from "@/lib/server/ctx";
import { seedTenant } from "@/lib/server/seed";
import { MemoryBucket } from "./memory-bucket";
import { SqliteD1 } from "./sqlite-d1";

export async function makeCtx(options: { seed?: boolean } = {}): Promise<Ctx> {
  const tenantRaw = new SqliteD1();
  const controlRaw = new SqliteD1();
  const db = new Db(tenantRaw);
  const control = new Db(controlRaw);
  await migrate(db, tenantMigrations);
  await migrate(control, controlMigrations);
  const ctx: Ctx = {
    tenant: { id: "t1", slug: "test", name: "Test AG", locale: "de-CH" },
    user: { id: "u1", name: "Test User", email: "test@example.com" },
    role: "owner",
    scope: "write",
    actor: { type: "user", id: "u1", name: "Test User", source: "ui" },
    db,
    control,
    files: new MemoryBucket(),
  };
  if (options.seed !== false) await seedTenant(ctx, { name: "Test AG", language: "de" });
  return ctx;
}
