import type { Db } from "./db";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Splits a migration script into individual statements (no semicolons inside literals). */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const migratedKeys = new Set<string>();

/**
 * Applies pending migrations. Each migration runs in a single D1 batch, i.e. in
 * one transaction together with its bookkeeping row, so a failure leaves the
 * database untouched. Results are cached per isolate under `cacheKey`.
 */
export async function migrate(db: Db, migrations: Migration[], cacheKey?: string): Promise<number> {
  if (cacheKey && migratedKeys.has(cacheKey)) return 0;

  await db.run(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
  );
  const applied = new Set((await db.all<{ id: number }>("SELECT id FROM _migrations")).map((r) => r.id));

  let count = 0;
  for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(migration.id)) continue;
    await db.batch([
      ...splitStatements(migration.sql).map((sql) => ({ sql })),
      { sql: "INSERT INTO _migrations (id, name) VALUES (?, ?)", params: [migration.id, migration.name] },
    ]);
    count++;
  }

  if (cacheKey) migratedKeys.add(cacheKey);
  return count;
}

export function latestMigrationId(migrations: Migration[]): number {
  return migrations.reduce((max, m) => Math.max(max, m.id), 0);
}
