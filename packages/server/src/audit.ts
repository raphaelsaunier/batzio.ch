import { sha256Hex } from "./auth/crypto";
import type { Ctx } from "./ctx";
import type { Statement } from "./db/db";

export interface AuditInput {
  action: string;
  resource?: string;
  resourceId?: string | number | null;
  summary?: string;
  changes?: Record<string, { from: unknown; to: unknown }> | Record<string, unknown> | null;
  /** Extra provenance for this entry, on top of the actor's. */
  context?: Record<string, unknown>;
  /** The entry this one undoes. */
  rollbackOf?: number;
}

export interface AuditRow {
  id: number;
  at: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  source: string;
  action: string;
  resource: string | null;
  resource_id: string | null;
  summary: string | null;
  changes: string | null;
  ip: string | null;
  user_agent: string | null;
  hash: string | null;
  context: string | null;
  rollback_of: number | null;
  hash_version: number;
}

const IGNORED = new Set(["updated_at", "updated_by", "created_at", "created_by"]);

/** Field-level diff between two records, ignoring bookkeeping columns. */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    const a = before?.[key] ?? null;
    const b = after?.[key] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = { from: a, to: b };
  }
  return out;
}

/** Builds the insert statement so it can join the same batch (transaction) as the change itself. */
export function auditStatement(ctx: Ctx, input: AuditInput & { resourceIdSql?: string }): Statement {
  // `resourceIdSql` lets a batch reference a row inserted earlier in the same transaction.
  const idSql = input.resourceIdSql ? `CAST((${input.resourceIdSql}) AS TEXT)` : "?";
  const idParams =
    input.resourceIdSql ? [] : [input.resourceId === null || input.resourceId === undefined ? null : String(input.resourceId)];
  const context = { ...ctx.actor.context, ...input.context };
  return {
    sql: `INSERT INTO audit_log (actor_type, actor_id, actor_name, source, action, resource, resource_id, summary, changes, ip, user_agent, context, rollback_of, hash_version)
          VALUES (?, ?, ?, ?, ?, ?, ${idSql}, ?, ?, ?, ?, ?, ?, 2)`,
    params: [
      ctx.actor.type,
      ctx.actor.id,
      ctx.actor.name,
      ctx.actor.source,
      input.action,
      input.resource ?? null,
      ...idParams,
      input.summary ?? null,
      input.changes && Object.keys(input.changes).length ? JSON.stringify(input.changes) : null,
      ctx.actor.ip ?? null,
      ctx.actor.userAgent?.slice(0, 300) ?? null,
      Object.keys(context).length ? JSON.stringify(context) : null,
      input.rollbackOf ?? null,
    ],
  };
}

export async function audit(ctx: Ctx, input: AuditInput): Promise<void> {
  const stmt = auditStatement(ctx, input);
  await ctx.db.run(stmt.sql, ...(stmt.params ?? []));
  await sealAuditLog(ctx);
}

/**
 * What a row's hash covers. Version 2 adds provenance and the undone entry. The IP
 * address and user agent stay outside the chain, so they can be erased once they
 * are no longer needed without breaking it.
 */
function canonical(row: AuditRow): string {
  const base = [row.id, row.at, row.actor_type, row.actor_id, row.actor_name, row.source, row.action, row.resource, row.resource_id, row.summary, row.changes];
  return JSON.stringify((row.hash_version ?? 1) >= 2 ? [...base, row.context ?? null, row.rollback_of ?? null] : base);
}

const GENESIS = "0".repeat(64);

/**
 * Chains unsealed audit rows: hash(n) = sha256(hash(n-1) + canonical(row n)).
 * Sealing is deterministic and idempotent, so concurrent sealers agree.
 * Any later modification or deletion of a row breaks verification.
 */
export async function sealAuditLog(ctx: Ctx, limit = 500): Promise<number> {
  const pending = await ctx.db.all<AuditRow>(
    "SELECT * FROM audit_log WHERE hash IS NULL ORDER BY id LIMIT ?",
    limit,
  );
  if (!pending.length) return 0;
  const prev = await ctx.db.first<{ hash: string }>(
    "SELECT hash FROM audit_log WHERE id < ? AND hash IS NOT NULL ORDER BY id DESC LIMIT 1",
    pending[0].id,
  );
  let previous = prev?.hash ?? GENESIS;
  const updates = [];
  for (const row of pending) {
    previous = await sha256Hex(previous + canonical(row));
    updates.push({ sql: "UPDATE audit_log SET hash = ? WHERE id = ? AND hash IS NULL", params: [previous, row.id] });
  }
  await ctx.db.batch(updates);
  return pending.length;
}

export interface AuditVerification {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
}

/** Recomputes the whole chain and reports the first row whose hash does not match. */
export async function verifyAuditLog(ctx: Ctx): Promise<AuditVerification> {
  await sealAuditLog(ctx, 5000);
  let previous = GENESIS;
  let checked = 0;
  let lastId = 0;
  for (;;) {
    const rows = await ctx.db.all<AuditRow>("SELECT * FROM audit_log WHERE id > ? ORDER BY id LIMIT 1000", lastId);
    if (!rows.length) break;
    for (const row of rows) {
      const expected = await sha256Hex(previous + canonical(row));
      if (row.hash !== expected) return { ok: false, checked, brokenAt: row.id };
      previous = expected;
      checked++;
      lastId = row.id;
    }
  }
  return { ok: true, checked, brokenAt: null };
}
