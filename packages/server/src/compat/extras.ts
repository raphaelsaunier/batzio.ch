import type { Ctx } from "../ctx";
import type { Row } from "../resources/types";

/**
 * Wire fields Batzio has no column for (fax, Skype name, …) are kept per
 * record, so whatever an integration writes, it reads back unchanged.
 */
export async function loadExtras(ctx: Ctx, kind: string, ids: number[]): Promise<Map<number, Row>> {
  const out = new Map<number, Row>();
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await ctx.db.all<{ record_id: number; data: string }>(
      `SELECT record_id, data FROM compat_extras WHERE kind = ? AND record_id IN (${chunk.map(() => "?").join(", ")})`,
      kind,
      ...chunk,
    );
    for (const r of rows) {
      try {
        out.set(Number(r.record_id), JSON.parse(r.data) as Row);
      } catch {
        // A damaged row only loses its extras.
      }
    }
  }
  return out;
}

export async function saveExtras(ctx: Ctx, kind: string, id: number, body: Row, fields: string[]): Promise<void> {
  const present = fields.filter((f) => Object.prototype.hasOwnProperty.call(body, f));
  if (!present.length) return;
  const current = (await loadExtras(ctx, kind, [id])).get(id) ?? {};
  for (const f of present) current[f] = body[f];
  await ctx.db.run(
    `INSERT INTO compat_extras (kind, record_id, data) VALUES (?, ?, ?)
     ON CONFLICT(kind, record_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    kind,
    id,
    JSON.stringify(current),
  );
}
