import type { Area } from "@batzio/core/permissions";
import { audit } from "../audit";
import { createRecord, deleteRecord, updateRecord } from "../crud";
import { assertCan, type Ctx } from "../ctx";
import { AppError, notFound } from "../errors";
import { getResource } from "../resources/registry";
import { loadExtras, saveExtras } from "./extras";
import type { ResourceDef, Row } from "../resources/types";
import { bodyObject, created, ok, orderBy, paging, pathId, route, searchWhere, type CompatCall, type Columns, type Route } from "./wire";

/**
 * One wire resource backed by one Batzio table. Reads go straight to the table
 * (scoped, permission-checked); writes go through the Batzio resource, so
 * validation, numbering, bookings and the audit trail apply exactly as in the app.
 */
export interface Mapping {
  table: string;
  area: Area;
  /** Batzio resource used for writes. Without it, `rawColumns` are written directly (simple lists). */
  resource?: string;
  rawColumns?: string[];
  label?: string;
  scope?: Row;
  /** Extra list filter from the query string (archived, …). */
  filter?: (query: URLSearchParams) => { sql: string; args?: unknown[] } | null;
  columns: Columns;
  defaultOrder?: string;
  read: (row: Row, ctx: Ctx) => Row | Promise<Row>;
  write?: (body: Row, ctx: Ctx, existing: Row | null) => Row | Promise<Row>;
  /** Wire fields without a Batzio column, stored as extras (see extras.ts). */
  extras?: string[];
  /** Extras key when several mappings share a table (defaults to the table). */
  kind?: string;
}

export const has = (body: Row, key: string) => Object.prototype.hasOwnProperty.call(body, key);

/** Copies the wire fields present in `body` to Batzio fields: `{ wire: "ours" | (v) => partial }`. */
export function pick(body: Row, map: Record<string, string | ((v: unknown, body: Row) => Row)>): Row {
  const out: Row = {};
  for (const [wire, target] of Object.entries(map)) {
    if (!has(body, wire)) continue;
    if (typeof target === "string") out[target] = body[wire] === "" ? null : body[wire];
    else Object.assign(out, target(body[wire], body));
  }
  return out;
}

function resourceOf(m: Mapping): ResourceDef | null {
  if (!m.resource) return null;
  const res = getResource(m.resource);
  if (!res) throw new AppError("internal", "Unknown resource.");
  return res;
}

function scopeSql(m: Mapping): { sql: string[]; args: unknown[] } {
  const entries = Object.entries(m.scope ?? {});
  return { sql: entries.map(([k]) => `${k} = ?`), args: entries.map(([, v]) => v) };
}

export async function selectRows(
  ctx: Ctx,
  m: Mapping,
  opts: { where?: string[]; args?: unknown[]; order?: string; limit?: number; offset?: number; query?: URLSearchParams } = {},
): Promise<Row[]> {
  assertCan(ctx, m.area, "read");
  const scope = scopeSql(m);
  const extra = opts.query && m.filter ? m.filter(opts.query) : null;
  const where = [...scope.sql, ...(extra ? [extra.sql] : []), ...(opts.where ?? [])];
  const args = [...scope.args, ...(extra?.args ?? []), ...(opts.args ?? [])];
  const sql = `SELECT * FROM ${m.table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${opts.order ?? orderBy(null, m.columns, m.defaultOrder)}${
    opts.limit !== undefined ? ` LIMIT ${Math.trunc(opts.limit)} OFFSET ${Math.trunc(opts.offset ?? 0)}` : ""
  }`;
  return ctx.db.all<Row>(sql, ...args);
}

export async function countRows(ctx: Ctx, m: Mapping, where: string[] = [], args: unknown[] = []): Promise<number> {
  const scope = scopeSql(m);
  const all = [...scope.sql, ...where];
  return Number(await ctx.db.value(`SELECT count(*) FROM ${m.table}${all.length ? ` WHERE ${all.join(" AND ")}` : ""}`, ...scope.args, ...args)) || 0;
}

export async function findRow(ctx: Ctx, m: Mapping, id: number): Promise<Row | null> {
  const rows = await selectRows(ctx, m, { where: ["id = ?"], args: [id], limit: 1 });
  return rows[0] ?? null;
}

export async function loadRow(ctx: Ctx, m: Mapping, id: number): Promise<Row> {
  const row = await findRow(ctx, m, id);
  if (!row) throw notFound(m.label ?? "Record");
  return row;
}

const extrasKind = (m: Mapping) => m.kind ?? m.table;

export async function wireAll(ctx: Ctx, m: Mapping, rows: Row[]): Promise<Row[]> {
  const extras = m.extras?.length ? await loadExtras(ctx, extrasKind(m), rows.map((r) => Number(r.id))) : null;
  return Promise.all(
    rows.map(async (r) => {
      const out = await m.read(r, ctx);
      const stored = extras?.get(Number(r.id));
      if (stored) for (const f of m.extras!) if (f in stored) out[f] = stored[f];
      return out;
    }),
  );
}

export const wire = async (ctx: Ctx, m: Mapping, row: Row) => (await wireAll(ctx, m, [row]))[0];

export async function listWire(call: CompatCall, m: Mapping, extra: { where?: string[]; args?: unknown[] } = {}) {
  const { limit, offset } = paging(call.query);
  const rows = await selectRows(call.ctx, m, { ...extra, order: orderBy(call.query.get("order_by"), m.columns, m.defaultOrder), limit, offset, query: call.query });
  return wireAll(call.ctx, m, rows);
}

export async function searchWire(call: CompatCall, m: Mapping, extra: { where?: string[]; args?: unknown[] } = {}) {
  const { limit, offset } = paging(call.query);
  const s = searchWhere(call.body ?? [], m.columns);
  const rows = await selectRows(call.ctx, m, {
    where: [...(extra.where ?? []), ...s.sql],
    args: [...(extra.args ?? []), ...s.args],
    order: orderBy(call.query.get("order_by"), m.columns, m.defaultOrder),
    limit,
    offset,
    query: call.query,
  });
  return wireAll(call.ctx, m, rows);
}

export async function createWire(ctx: Ctx, m: Mapping, body: Row, extra: Row = {}): Promise<Row> {
  const input = { ...(m.write ? await m.write(body, ctx, null) : {}), ...extra };
  const res = resourceOf(m);
  let id: number;
  if (res) {
    id = Number((await createRecord(ctx, res, input)).id);
  } else {
    assertCan(ctx, m.area, "write");
    const cols = (m.rawColumns ?? []).filter((c) => input[c] !== undefined);
    const scope = Object.entries(m.scope ?? {});
    const names = [...cols, ...scope.map(([k]) => k)];
    const result = await ctx.db.run(
      `INSERT INTO ${m.table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
      ...cols.map((c) => input[c]),
      ...scope.map(([, v]) => v),
    );
    id = result.lastRowId;
    await audit(ctx, { action: "create", resource: m.table, resourceId: id, summary: `Created ${m.label?.toLowerCase() ?? m.table} via API` });
  }
  if (m.extras) await saveExtras(ctx, extrasKind(m), id, body, m.extras);
  return wire(ctx, m, await loadRow(ctx, m, id));
}

export async function updateWire(ctx: Ctx, m: Mapping, id: number, body: Row): Promise<Row> {
  const existing = await loadRow(ctx, m, id);
  const input = m.write ? await m.write(body, ctx, existing) : {};
  const res = resourceOf(m);
  if (res) {
    if (Object.keys(input).length) await updateRecord(ctx, res, id, input);
  } else {
    assertCan(ctx, m.area, "write");
    const cols = (m.rawColumns ?? []).filter((c) => input[c] !== undefined);
    if (cols.length) {
      await ctx.db.run(`UPDATE ${m.table} SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`, ...cols.map((c) => input[c]), id);
      await audit(ctx, { action: "update", resource: m.table, resourceId: id, summary: `Updated ${m.label?.toLowerCase() ?? m.table} via API` });
    }
  }
  if (m.extras) await saveExtras(ctx, extrasKind(m), id, body, m.extras);
  return wire(ctx, m, await loadRow(ctx, m, id));
}

export async function deleteWire(ctx: Ctx, m: Mapping, id: number): Promise<void> {
  await loadRow(ctx, m, id);
  const res = resourceOf(m);
  if (res) {
    await deleteRecord(ctx, res, id);
  } else {
    assertCan(ctx, m.area, "write");
    await ctx.db.run(`DELETE FROM ${m.table} WHERE id = ?`, id);
    await audit(ctx, { action: "delete", resource: m.table, resourceId: id, summary: `Deleted ${m.label?.toLowerCase() ?? m.table} via API` });
  }
}

type Op = "list" | "create" | "search" | "show" | "edit" | "delete";

/** The usual set of routes for one wire resource. */
export function crud(base: string, idParam: string, m: Mapping, ops: Op[], opts: { edit?: "POST" | "PUT" | "PATCH"; tag?: number } = {}): Route[] {
  const item = `${base}/{${idParam}}`;
  const routes: Route[] = [];
  for (const op of ops) {
    switch (op) {
      case "list":
        routes.push(route("GET", base, (c) => listWire(c, m)));
        break;
      case "search":
        routes.push(route("POST", `${base}/search`, (c) => searchWire(c, m)));
        break;
      case "create":
        routes.push(route("POST", base, async (c) => created(await createWire(c.ctx, m, bodyObject(c)))));
        break;
      case "show":
        routes.push(route("GET", item, async (c) => wire(c.ctx, m, await loadRow(c.ctx, m, pathId(c, idParam, opts.tag)))));
        break;
      case "edit":
        routes.push(route(opts.edit ?? "POST", item, async (c) => updateWire(c.ctx, m, pathId(c, idParam, opts.tag), bodyObject(c))));
        break;
      case "delete":
        routes.push(
          route("DELETE", item, async (c) => {
            await deleteWire(c.ctx, m, pathId(c, idParam, opts.tag));
            return ok;
          }),
        );
        break;
    }
  }
  return routes;
}
