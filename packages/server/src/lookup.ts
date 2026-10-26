import { ident, placeholders } from "./db/db";
import { canCtx, type Ctx } from "./ctx";
import { getResource } from "./resources/registry";

/**
 * Lookups behind pickers and search: reference options, catalogue item
 * defaults for document positions and a cross-resource quick search.
 * Shared by the web UI and the native apps' API.
 */

export interface RefOption {
  id: number;
  label: string;
}

/** Options for reference pickers, with optional text search and equality filters. */
export async function refOptions(
  ctx: Ctx,
  resource: string,
  query: string,
  filter?: Record<string, string | number | boolean>,
  ids?: number[],
): Promise<RefOption[]> {
  const res = getResource(resource);
  if (!res || !canCtx(ctx, res.area, "read")) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(res.scope ?? {})) {
    where.push(`${ident(k)} = ?`);
    args.push(v);
  }
  if (res.softDelete) where.push("archived_at IS NULL");
  if (ids?.length) {
    where.push(`id IN (${placeholders(ids.length)})`);
    args.push(...ids);
  } else {
    for (const [k, v] of Object.entries(filter ?? {})) {
      if (!res.fields.some((f) => f.name === k)) continue;
      // Picking an open invoice should also include partially paid ones.
      if (k === "status" && v === "open") {
        where.push("status IN ('open','partial')");
        continue;
      }
      where.push(`${ident(k)} = ?`);
      args.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
    if (query.trim()) {
      const like = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const parts = [`(${res.titleSql}) LIKE ? ESCAPE '\\'`];
      args.push(like);
      for (const f of res.fields.filter((x) => x.search).slice(0, 4)) {
        parts.push(`${ident(f.name)} LIKE ? ESCAPE '\\'`);
        args.push(like);
      }
      where.push(`(${parts.join(" OR ")})`);
    }
  }
  const order = res.defaultSort.field;
  const rows = await ctx.db.all<{ id: number; label: string }>(
    `SELECT id, (${res.titleSql}) AS label FROM ${ident(res.table)} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${ident(order)} ${res.defaultSort.dir === "desc" ? "DESC" : "ASC"} LIMIT 30`,
    ...args,
  );
  return rows.map((r) => ({ id: r.id, label: r.label ?? `#${r.id}` }));
}

export interface ItemDefaults {
  code: string | null;
  text: string;
  unit_name: string | null;
  unit_price: number;
  tax_id: number | null;
  tax_label: string | null;
}

/** Prices, texts and VAT of a catalogue item for document positions. */
export async function itemDefaults(ctx: Ctx, itemId: number, purchase = false): Promise<ItemDefaults | null> {
  const item = await ctx.db.first<Record<string, unknown>>(
    `SELECT items.*, units.name AS unit_label, t.id AS tax_id_resolved, t.code || ' (' || t.rate || '%)' AS tax_label
     FROM items LEFT JOIN units ON units.id = items.unit_id
     LEFT JOIN taxes t ON t.id = ${purchase ? "items.purchase_tax_id" : "items.sales_tax_id"}
     WHERE items.id = ?`,
    itemId,
  );
  if (!item) return null;
  return {
    code: (item.nr as string) ?? null,
    text: [item.name, item.description].filter(Boolean).join("\n"),
    unit_name: (item.unit_label as string) ?? null,
    unit_price: Number((purchase ? item.purchase_price : item.sale_price) ?? 0),
    tax_id: (item.tax_id_resolved as number) ?? null,
    tax_label: (item.tax_label as string) ?? null,
  };
}

export interface SearchHit {
  resource: string;
  resourceLabel: string;
  id: number;
  label: string;
}

const SEARCHABLE = ["contacts", "invoices", "quotes", "orders", "bills", "items", "projects", "accounts", "employees"];

export async function globalSearch(ctx: Ctx, query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const name of SEARCHABLE) {
    const res = getResource(name)!;
    if (!canCtx(ctx, res.area, "read")) continue;
    const options = await refOptions(ctx, name, q);
    for (const o of options.slice(0, 5)) {
      hits.push({ resource: name, resourceLabel: res.labelPlural, id: o.id, label: o.label });
    }
  }
  return hits;
}
