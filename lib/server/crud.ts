import { z } from "zod";
import { addDays, today } from "@/lib/format";
import { fromCents, toCents } from "@/lib/money";
import { coerceInput, fieldSchema, formatZodError, resourceSchema } from "@/lib/resources/schema";
import type { ActionResult, ChildDef, FieldDef, ResourceDef, Row } from "@/lib/resources/types";
import { auditStatement, diff, sealAuditLog } from "./audit";
import { assertCan, type Ctx } from "./ctx";
import { ident, placeholders, type Statement } from "./db/db";
import { AppError, notFound } from "./errors";
import { nextNumber } from "./numbering";

/**
 * Generic, definition-driven persistence. All functions take and return rows in
 * DB representation (money in cents, booleans as 0/1). Use `toApi` to convert
 * for external consumers.
 */

const SYSTEM_COLUMNS = new Set(["id", "created_at", "updated_at"]);
export const RESERVED_PARAMS = new Set([
  "q", "sort", "dir", "limit", "offset", "page", "per_page", "format", "archived", "tenant", "expand", "ids",
]);

// ------------------------------------------------------------ conversions

export function dbValue(field: FieldDef, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  switch (field.type) {
    case "money":
      return toCents(value as number);
    case "boolean":
      return value ? 1 : 0;
    case "tags":
      return Array.isArray(value) ? JSON.stringify(value) : value;
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    default:
      return value;
  }
}

export function apiValue(field: FieldDef, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case "money":
      return fromCents(Number(value));
    case "boolean":
      return Boolean(Number(value));
    case "tags":
    case "json":
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return field.type === "tags" ? [] : value;
        }
      }
      return value;
    default:
      return value;
  }
}

function convertRow(fields: FieldDef[], row: Row, fn: (f: FieldDef, v: unknown) => unknown): Row {
  const out: Row = {};
  for (const field of fields) if (field.name in row) out[field.name] = fn(field, row[field.name]);
  return out;
}

/** DB row → API representation. */
export function toApi(res: ResourceDef, row: Row): Row {
  const out = convertRow(res.fields, row, apiValue);
  for (const child of res.children ?? []) {
    const rows = row[child.name];
    if (Array.isArray(rows)) out[child.name] = rows.map((r) => convertRow(child.fields, r as Row, apiValue));
  }
  return out;
}

export function parseJsonArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function resolveDefault(value: unknown): unknown {
  if (value === "$today") return today();
  if (typeof value === "string" && value.startsWith("$today+")) return addDays(today(), Number(value.slice(7)));
  return value;
}

export function recordTitle(res: ResourceDef, row: Row): string {
  // Documents and bookings are identified by their number; everything else by its name.
  const numbered = res.view === "document" || res.view === "bill" || res.view === "entry" || res.name === "expenses";
  const keys = numbered
    ? ["nr", "ref_nr", "number", "title", "name", "subject", "code", "description"]
    : ["name_1", "name", "subject", "title", "code", "number", "nr", "ref_nr", "description"];
  if (res.name === "accounts" && row.number && row.name) return `${row.number} ${row.name}`;
  if (res.name === "employees" && row.lastname) return `${row.firstname ?? ""} ${row.lastname}`.trim();
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) {
      if (key === "name_1" && typeof row.name_2 === "string" && row.name_2) {
        return row.type === "person" ? `${row.name_2} ${v}` : v;
      }
      return v;
    }
  }
  return `#${row.id ?? "new"}`;
}

// ------------------------------------------------------------ validation

/** Validates API-shaped input and returns it in DB representation (children included). */
export function parseInput(res: ResourceDef, input: Row, mode: "create" | "update"): Row {
  const coerced = coerceInput(res.fields, input ?? {});
  for (const child of res.children ?? []) {
    const rows = coerced[child.name];
    if (Array.isArray(rows)) coerced[child.name] = rows.map((r) => coerceInput(child.fields, (r ?? {}) as Row));
  }
  if (mode === "create") {
    for (const field of res.fields) {
      if (field.default !== undefined && (coerced[field.name] === undefined || coerced[field.name] === null)) {
        coerced[field.name] = resolveDefault(field.default);
      }
    }
  }
  const parsed = resourceSchema(res, mode).safeParse(coerced);
  if (!parsed.success) {
    const failure = formatZodError(parsed.error, Object.fromEntries(res.fields.map((f) => [f.name, f.label])));
    throw new AppError("validation", failure.message, failure.fields, failure.vars);
  }
  const data = parsed.data as Row;

  if (mode === "update") {
    for (const field of res.fields) {
      if (field.required && field.name in data && data[field.name] === null) {
        throw new AppError("validation", "{field} is required.", { [field.name]: "Required" }, { field: field.label });
      }
    }
  }

  const out = convertRow(res.fields, data, dbValue);
  for (const child of res.children ?? []) {
    const rows = data[child.name];
    if (Array.isArray(rows)) {
      out[child.name] = rows.map((r) => {
        const row = r as Row;
        const withDefaults: Row = { ...row };
        for (const f of child.fields) {
          if (f.default !== undefined && (withDefaults[f.name] === undefined || withDefaults[f.name] === null)) {
            withDefaults[f.name] = resolveDefault(f.default);
          }
        }
        return convertRow(child.fields, withDefaults, dbValue);
      });
    }
  }
  return out;
}

export function parseActionInput(fields: FieldDef[] | undefined, input: Row): Row {
  if (!fields?.length) return {};
  const coerced = coerceInput(fields, input ?? {});
  for (const field of fields) {
    if (field.default !== undefined && (coerced[field.name] === undefined || coerced[field.name] === null)) {
      coerced[field.name] = resolveDefault(field.default);
    }
  }
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) shape[field.name] = field.required ? fieldSchema(field) : fieldSchema(field).nullable().optional();
  const parsed = z.object(shape).safeParse(coerced);
  if (!parsed.success) {
    const failure = formatZodError(parsed.error, Object.fromEntries(fields.map((f) => [f.name, f.label])));
    throw new AppError("validation", failure.message, failure.fields, failure.vars);
  }
  return convertRow(fields, parsed.data as Row, dbValue);
}

// ------------------------------------------------------------------ reads

export interface ListParams {
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
  filters?: Record<string, string>;
  archived?: "include" | "only";
  ids?: number[];
}

export interface ListResult {
  rows: Row[];
  total: number;
  limit: number;
  offset: number;
}

export function listParamsFrom(search: URLSearchParams | Record<string, string | string[] | undefined>): ListParams {
  const get = (k: string): string | undefined => {
    if (search instanceof URLSearchParams) return search.get(k) ?? undefined;
    const v = search[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const entries: [string, string][] =
    search instanceof URLSearchParams
      ? [...search.entries()]
      : Object.entries(search).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]]));
  const filters: Record<string, string> = {};
  for (const [k, v] of entries) if (!RESERVED_PARAMS.has(k) && v !== "") filters[k] = v;
  const perPage = Number(get("limit") ?? get("per_page") ?? 25);
  const page = Number(get("page") ?? 1);
  const limit = Math.min(Math.max(Number.isFinite(perPage) ? perPage : 25, 1), 500);
  const offset = get("offset") !== undefined ? Math.max(0, Number(get("offset")) || 0) : (Math.max(1, page) - 1) * limit;
  const archived = get("archived");
  const ids = get("ids")
    ?.split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return {
    q: get("q")?.trim() || undefined,
    sort: get("sort") || undefined,
    dir: get("dir") === "asc" ? "asc" : get("dir") === "desc" ? "desc" : undefined,
    limit,
    offset,
    filters,
    archived: archived === "include" || archived === "only" ? archived : undefined,
    ids: ids?.length ? ids : undefined,
  };
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export function buildWhere(res: ResourceDef, params: ListParams): { sql: string; args: unknown[] } {
  const clauses: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(res.scope ?? {})) {
    clauses.push(`${ident(k)} = ?`);
    args.push(v);
  }
  if (res.softDelete) {
    if (params.archived === "only") clauses.push("archived_at IS NOT NULL");
    else if (params.archived !== "include") clauses.push("archived_at IS NULL");
  }
  if (params.ids?.length) {
    clauses.push(`id IN (${placeholders(params.ids.length)})`);
    args.push(...params.ids);
  }
  if (params.q) {
    const like = `%${escapeLike(params.q)}%`;
    const parts = [`(${res.titleSql}) LIKE ? ESCAPE '\\'`];
    args.push(like);
    for (const field of res.fields.filter((f) => f.search)) {
      parts.push(`${ident(field.name)} LIKE ? ESCAPE '\\'`);
      args.push(like);
    }
    if (/^\d+$/.test(params.q)) {
      parts.push("id = ?");
      args.push(Number(params.q));
    }
    clauses.push(`(${parts.join(" OR ")})`);
  }
  const byName = new Map(res.fields.map((f) => [f.name, f]));
  for (const [key, raw] of Object.entries(params.filters ?? {})) {
    let name = key;
    let op: string | undefined;
    if (!byName.has(key)) {
      const m = /^(.*)_(gte|lte|gt|lt|in|ne|null)$/.exec(key);
      if (!m) continue;
      name = m[1];
      op = m[2];
    }
    const field = byName.get(name);
    if (!field || field.type === "json" || field.type === "text") continue;
    const col = ident(field.name);
    const conv = (v: string) => dbValue(field, coerceInput([field], { [field.name]: v })[field.name]);
    if (field.type === "tags") {
      clauses.push(`EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?)`);
      args.push(Number(raw));
      continue;
    }
    switch (op) {
      case "gte":
        clauses.push(`${col} >= ?`);
        args.push(conv(raw));
        break;
      case "lte":
        clauses.push(`${col} <= ?`);
        args.push(conv(raw));
        break;
      case "gt":
        clauses.push(`${col} > ?`);
        args.push(conv(raw));
        break;
      case "lt":
        clauses.push(`${col} < ?`);
        args.push(conv(raw));
        break;
      case "ne":
        clauses.push(`(${col} IS NULL OR ${col} != ?)`);
        args.push(conv(raw));
        break;
      case "null":
        clauses.push(raw === "false" || raw === "0" ? `${col} IS NOT NULL` : `${col} IS NULL`);
        break;
      case "in": {
        const values = raw.split(",").map((v) => conv(v.trim()));
        clauses.push(`${col} IN (${placeholders(values.length)})`);
        args.push(...values);
        break;
      }
      default:
        clauses.push(`${col} = ?`);
        args.push(conv(raw));
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", args };
}

function orderBy(res: ResourceDef, params: ListParams): string {
  const allowed = new Set(["id", "created_at", "updated_at", ...res.fields.filter((f) => f.sortable || f.list).map((f) => f.name)]);
  const sort = params.sort && allowed.has(params.sort) ? params.sort : res.defaultSort.field;
  const dir = (params.dir ?? (params.sort ? "asc" : res.defaultSort.dir)).toUpperCase();
  return `ORDER BY ${ident(sort)} ${dir === "ASC" ? "ASC" : "DESC"}, id DESC`;
}

export async function listRecords(ctx: Ctx, res: ResourceDef, params: ListParams = {}): Promise<ListResult> {
  assertCan(ctx, res.area, "read");
  const where = buildWhere(res, params);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;
  const [rows, total] = await Promise.all([
    ctx.db.all<Row>(
      `SELECT * FROM ${ident(res.table)} ${where.sql} ${orderBy(res, params)} LIMIT ? OFFSET ?`,
      ...where.args,
      limit,
      offset,
    ),
    ctx.db.value<number>(`SELECT COUNT(*) FROM ${ident(res.table)} ${where.sql}`, ...where.args),
  ]);
  return { rows, total: total ?? 0, limit, offset };
}

/** Sums numeric columns over all rows matching the list parameters. */
export async function sumColumns(ctx: Ctx, res: ResourceDef, params: ListParams, columns: string[]): Promise<Record<string, number>> {
  if (!columns.length) return {};
  const where = buildWhere(res, params);
  const row = await ctx.db.first<Record<string, number | null>>(
    `SELECT ${columns.map((c) => `SUM(${ident(c)}) AS ${ident(c)}`).join(", ")} FROM ${ident(res.table)} ${where.sql}`,
    ...where.args,
  );
  return Object.fromEntries(columns.map((c) => [c, Number(row?.[c] ?? 0)]));
}

/** Streams every matching row (for exports), in pages. */
export async function listAll(ctx: Ctx, res: ResourceDef, params: ListParams = {}, max = 20_000): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset = 0; offset < max; offset += 500) {
    const page = await listRecords(ctx, res, { ...params, limit: 500, offset });
    out.push(...page.rows);
    if (page.rows.length < 500) break;
  }
  return out;
}

async function loadChildren(ctx: Ctx, child: ChildDef, parentId: number): Promise<Row[]> {
  return ctx.db.all<Row>(
    `SELECT * FROM ${ident(child.table)} WHERE ${ident(child.foreignKey)} = ? ORDER BY ${ident(child.orderBy)}, id`,
    parentId,
  );
}

export async function findRecord(ctx: Ctx, res: ResourceDef, id: number, withChildren = true): Promise<Row | null> {
  assertCan(ctx, res.area, "read");
  const scope = Object.entries(res.scope ?? {});
  const row = await ctx.db.first<Row>(
    `SELECT * FROM ${ident(res.table)} WHERE id = ?${scope.map(([k]) => ` AND ${ident(k)} = ?`).join("")}`,
    id,
    ...scope.map(([, v]) => v),
  );
  if (!row) return null;
  if (withChildren) {
    for (const child of res.children ?? []) row[child.name] = await loadChildren(ctx, child, id);
  }
  return row;
}

export async function getRecord(ctx: Ctx, res: ResourceDef, id: number, withChildren = true): Promise<Row> {
  const row = await findRecord(ctx, res, id, withChildren);
  if (!row) throw notFound(res.label);
  return row;
}

/** Resolves display labels for ref fields: { field: { id: label } }. */
export async function refLabels(
  ctx: Ctx,
  res: Pick<ResourceDef, "fields">,
  rows: Row[],
  resolve: (name: string) => ResourceDef | undefined,
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  const byTarget = new Map<string, { fields: string[]; ids: Set<number> }>();
  for (const field of res.fields) {
    if ((field.type !== "ref" && field.type !== "tags") || !field.ref) continue;
    const entry = byTarget.get(field.ref) ?? { fields: [], ids: new Set<number>() };
    entry.fields.push(field.name);
    for (const row of rows) {
      const v = row[field.name];
      if (field.type === "tags") for (const id of parseJsonArray<number>(v)) entry.ids.add(Number(id));
      else if (v !== null && v !== undefined) entry.ids.add(Number(v));
    }
    byTarget.set(field.ref, entry);
  }
  await Promise.all(
    [...byTarget.entries()].map(async ([target, entry]) => {
      const def = resolve(target);
      const ids = [...entry.ids].filter((n) => Number.isFinite(n));
      const labels: Record<string, string> = {};
      if (def && ids.length) {
        for (let i = 0; i < ids.length; i += 90) {
          const chunk = ids.slice(i, i + 90);
          const found = await ctx.db.all<{ id: number; label: string }>(
            `SELECT id, (${def.titleSql}) AS label FROM ${ident(def.table)} WHERE id IN (${placeholders(chunk.length)})`,
            ...chunk,
          );
          for (const r of found) labels[String(r.id)] = r.label;
        }
      }
      for (const name of entry.fields) out[name] = labels;
    }),
  );
  return out;
}

// ----------------------------------------------------------------- writes

function columnsOf(fields: FieldDef[]): Set<string> {
  return new Set(fields.map((f) => f.name).filter((n) => !SYSTEM_COLUMNS.has(n)));
}

function splitChildren(res: ResourceDef, row: Row): { columns: Row; children: Record<string, Row[]> } {
  const columns: Row = {};
  const children: Record<string, Row[]> = {};
  const childNames = new Set((res.children ?? []).map((c) => c.name));
  for (const [k, v] of Object.entries(row)) {
    if (childNames.has(k)) {
      if (Array.isArray(v)) children[k] = v as Row[];
    } else columns[k] = v;
  }
  return { columns, children };
}

function childInserts(child: ChildDef, rows: Row[], parentIdSql: string, parentParams: unknown[]): Statement[] {
  const allowed = columnsOf(child.fields);
  allowed.delete(child.foreignKey);
  return rows.map((row, index) => {
    const data: Row = { ...row };
    if (allowed.has(child.orderBy) && (data[child.orderBy] === undefined || data[child.orderBy] === null)) {
      data[child.orderBy] = index;
    }
    const cols = Object.keys(data).filter((k) => allowed.has(k) && data[k] !== undefined);
    return {
      sql: `INSERT INTO ${ident(child.table)} (${[child.foreignKey, ...cols].map(ident).join(", ")})
            VALUES (${parentIdSql}${cols.map(() => ", ?").join("")})`,
      params: [...parentParams, ...cols.map((c) => data[c])],
    };
  });
}

export interface WriteOptions {
  /** Skip the role check (used by internal workflows that already checked). */
  trusted?: boolean;
  /** Ignore lockReason (internal status transitions). */
  force?: boolean;
  /** Skip the prepare hook (internal updates of computed fields). */
  raw?: boolean;
  auditAction?: string;
  auditSummary?: string;
}

export async function createRecord(ctx: Ctx, res: ResourceDef, input: Row, opts: WriteOptions = {}): Promise<Row> {
  if (!opts.trusted) assertCan(ctx, res.area, "write");
  if (res.readOnly || (res.noCreate && !opts.trusted)) throw new AppError("forbidden", "{resource} cannot be created directly.", undefined, { resource: res.labelPlural });

  let row = parseInput(res, input, "create");
  Object.assign(row, res.scope ?? {});
  if (res.numbering && !row[res.numbering.field]) {
    row[res.numbering.field] = await nextNumber(ctx, res.numbering.sequence);
  }
  if (res.hooks?.prepare && !opts.raw) row = await res.hooks.prepare(ctx, row, null);

  const { columns, children } = splitChildren(res, row);
  const allowed = columnsOf(res.fields);
  columns.created_by = ctx.actor.name;
  columns.updated_by = ctx.actor.name;
  const cols = Object.keys(columns).filter((k) => allowed.has(k) && columns[k] !== undefined);

  const table = ident(res.table);
  const lastId = `(SELECT MAX(id) FROM ${table})`;
  const statements: Statement[] = [
    { sql: `INSERT INTO ${table} (${cols.map(ident).join(", ")}) VALUES (${placeholders(cols.length)})`, params: cols.map((c) => columns[c]) },
  ];
  for (const child of res.children ?? []) {
    if (children[child.name]) statements.push(...childInserts(child, children[child.name], lastId, []));
  }
  const snapshot = Object.fromEntries(Object.entries(columns).filter(([k, v]) => v !== null && !k.endsWith("_by")));
  statements.push(
    auditStatement(ctx, {
      action: opts.auditAction ?? "create",
      resource: res.name,
      resourceIdSql: `SELECT MAX(id) FROM ${table}`,
      summary: opts.auditSummary ?? `Created ${res.label.toLowerCase()} ${recordTitle(res, columns)}`,
      changes: snapshot,
    }),
  );
  const results = await ctx.db.batch(statements);
  const id = results[0].lastRowId;
  await sealAuditLog(ctx).catch(() => undefined);

  const record = await getRecord(ctx, res, id);
  if (res.hooks?.afterWrite && !opts.raw) await res.hooks.afterWrite(ctx, record, null);
  return res.hooks?.afterWrite && !opts.raw ? getRecord(ctx, res, id) : record;
}

export async function updateRecord(ctx: Ctx, res: ResourceDef, id: number, input: Row, opts: WriteOptions = {}): Promise<Row> {
  if (!opts.trusted) assertCan(ctx, res.area, "write");
  if (res.readOnly) throw new AppError("forbidden", "{resource} are read-only.", undefined, { resource: res.labelPlural });
  const existing = await getRecord(ctx, res, id);
  const lock = res.hooks?.lockReason?.(existing);
  if (lock && !opts.force) throw new AppError("locked", lock);

  let row = opts.raw ? { ...input } : parseInput(res, input, "update");
  for (const key of Object.keys(res.scope ?? {})) delete row[key];
  if (res.hooks?.prepare && !opts.raw) row = await res.hooks.prepare(ctx, row, existing);

  const { columns, children } = splitChildren(res, row);
  const allowed = columnsOf(res.fields);
  const changed = Object.keys(columns).filter(
    (k) => allowed.has(k) && columns[k] !== undefined && JSON.stringify(columns[k]) !== JSON.stringify(existing[k] ?? null),
  );
  const childChanges = (res.children ?? []).filter((c) => children[c.name]);
  if (!changed.length && !childChanges.length) return existing;

  const changes = diff(
    Object.fromEntries(changed.map((k) => [k, existing[k] ?? null])),
    Object.fromEntries(changed.map((k) => [k, columns[k]])),
  ) as Record<string, unknown>;
  const statements: Statement[] = [];
  if (changed.length || childChanges.length) {
    const sets = [...changed.map((c) => `${ident(c)} = ?`), "updated_at = ?", "updated_by = ?"];
    statements.push({
      sql: `UPDATE ${ident(res.table)} SET ${sets.join(", ")} WHERE id = ?`,
      params: [...changed.map((c) => columns[c]), new Date().toISOString(), ctx.actor.name, id],
    });
  }
  for (const child of childChanges) {
    statements.push({ sql: `DELETE FROM ${ident(child.table)} WHERE ${ident(child.foreignKey)} = ?`, params: [id] });
    statements.push(...childInserts(child, children[child.name], "?", [id]));
    changes[child.name] = { from: `${(existing[child.name] as Row[] | undefined)?.length ?? 0} rows`, to: `${children[child.name].length} rows` };
  }
  statements.push(
    auditStatement(ctx, {
      action: opts.auditAction ?? "update",
      resource: res.name,
      resourceId: id,
      summary: opts.auditSummary ?? `Updated ${res.label.toLowerCase()} ${recordTitle(res, { ...existing, ...columns })}`,
      changes,
    }),
  );
  await ctx.db.batch(statements);
  await sealAuditLog(ctx).catch(() => undefined);

  const record = await getRecord(ctx, res, id);
  if (res.hooks?.afterWrite && !opts.raw) {
    await res.hooks.afterWrite(ctx, record, existing);
    return getRecord(ctx, res, id);
  }
  return record;
}

export async function deleteRecord(ctx: Ctx, res: ResourceDef, id: number, opts: WriteOptions = {}): Promise<void> {
  if (!opts.trusted) assertCan(ctx, res.area, "write");
  if (res.readOnly || (res.noDelete && !opts.trusted)) throw new AppError("forbidden", "{resource} cannot be deleted.", undefined, { resource: res.labelPlural });
  const existing = await getRecord(ctx, res, id, false);
  const title = recordTitle(res, existing);
  if (res.softDelete) {
    await ctx.db.batch([
      { sql: `UPDATE ${ident(res.table)} SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`, params: [new Date().toISOString(), new Date().toISOString(), ctx.actor.name, id] },
      auditStatement(ctx, { action: "archive", resource: res.name, resourceId: id, summary: `Archived ${res.label.toLowerCase()} ${title}` }),
    ]);
  } else {
    if (res.hooks?.beforeDelete) await res.hooks.beforeDelete(ctx, existing);
    const lock = res.hooks?.lockReason?.(existing);
    if (lock && !opts.force) throw new AppError("locked", lock);
    await ctx.db.batch([
      { sql: `DELETE FROM ${ident(res.table)} WHERE id = ?`, params: [id] },
      auditStatement(ctx, { action: "delete", resource: res.name, resourceId: id, summary: `Deleted ${res.label.toLowerCase()} ${title}`, changes: existing }),
    ]);
  }
  await sealAuditLog(ctx).catch(() => undefined);
}

export async function restoreRecord(ctx: Ctx, res: ResourceDef, id: number): Promise<Row> {
  assertCan(ctx, res.area, "write");
  if (!res.softDelete) throw new AppError("validation", "{resource} cannot be restored.", undefined, { resource: res.labelPlural });
  const existing = await getRecord(ctx, res, id, false);
  await ctx.db.batch([
    { sql: `UPDATE ${ident(res.table)} SET archived_at = NULL, updated_at = ?, updated_by = ? WHERE id = ?`, params: [new Date().toISOString(), ctx.actor.name, id] },
    auditStatement(ctx, { action: "restore", resource: res.name, resourceId: id, summary: `Restored ${res.label.toLowerCase()} ${recordTitle(res, existing)}` }),
  ]);
  await sealAuditLog(ctx).catch(() => undefined);
  return getRecord(ctx, res, id);
}

/** Directly sets computed/system columns without validation (status transitions, totals). */
export async function patchColumns(ctx: Ctx, res: Pick<ResourceDef, "table">, id: number, values: Row): Promise<void> {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  if (!keys.length) return;
  await ctx.db.run(
    `UPDATE ${ident(res.table)} SET ${[...keys.map((k) => `${ident(k)} = ?`), "updated_at = ?", "updated_by = ?"].join(", ")} WHERE id = ?`,
    ...keys.map((k) => values[k]),
    new Date().toISOString(),
    ctx.actor.name,
    id,
  );
}

export async function runAction(ctx: Ctx, res: ResourceDef, id: number, name: string, input: Row = {}): Promise<ActionResult> {
  const action = res.actions?.find((a) => a.name === name);
  if (!action) throw new AppError("not_found", "Unknown action “{name}”.", undefined, { name });
  assertCan(ctx, res.area, action.level ?? "write");
  const record = await getRecord(ctx, res, id);
  if (action.available && !action.available(record)) {
    throw new AppError("conflict", "“{action}” is not available in the current state.", undefined, { action: action.label });
  }
  const parsed = parseActionInput(action.input, input);
  const result = await action.run(ctx, record, parsed);
  if ((action.level ?? "write") === "write") {
    const stmt = auditStatement(ctx, {
      action: name,
      resource: res.name,
      resourceId: id,
      summary: `${action.label}: ${res.label.toLowerCase()} ${recordTitle(res, record)}`,
      changes: Object.keys(parsed).length ? parsed : null,
    });
    await ctx.db.run(stmt.sql, ...(stmt.params ?? []));
    await sealAuditLog(ctx).catch(() => undefined);
  }
  return result;
}

export function availableActions(res: ResourceDef, record: Row) {
  return (res.actions ?? []).filter((a) => !a.available || a.available(record));
}
