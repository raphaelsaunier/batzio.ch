import type { Ctx } from "../ctx";
import { AppError } from "../errors";
import type { Row } from "../resources/types";

/**
 * Wire conventions of the compatibility API (`/api/compat/{2,3,4}.0/…`): the
 * request and response shapes that existing Swiss accounting integrations
 * already speak, mapped onto Batzio's own data.
 */

export interface CompatCall {
  ctx: Ctx;
  request: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

/** A status other than 200, or a finished response (files, PDFs). Anything else a handler returns is the JSON body. */
export class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
    readonly response?: Response,
  ) {}
}

export type Handler = (call: CompatCall) => Promise<unknown>;

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** e.g. `/2.0/contact/{contact_id}` — the documented template. */
  path: string;
  handler: Handler;
}

export const route = (method: Route["method"], path: string, handler: Handler): Route => ({ method, path, handler });

export const ok = { success: true };
export const created = (body: unknown) => new Reply(201, body);
export const noContent = new Reply(204);
export const raw = (response: Response) => new Reply(response.status, undefined, response);

/** Errors are `{ error_code, message }`, like the APIs this one stands in for. */
export function errorBody(status: number, message: string) {
  return { error_code: status, message };
}

// ------------------------------------------------------------------ values

/** Money and quantities travel as decimal strings with six places ("12.500000"). */
export const dec = (value: unknown, places = 6): string => (Number(value ?? 0) || 0).toFixed(places);
export const decOrNull = (value: unknown, places = 6): string | null => (value === null || value === undefined || value === "" ? null : dec(value, places));
/** Integer minor units (Rappen) → decimal string. */
export const rappen = (value: unknown, places = 6): string => dec(Number(value ?? 0) / 100, places);
export const num = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : Number(value));
export const int = (value: unknown): number | null => {
  const n = num(value);
  return n === null || Number.isNaN(n) ? null : Math.trunc(n);
};
export const bool = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "true";
export const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
export const date = (value: unknown): string | null => (value ? String(value).slice(0, 10) : null);
/** Stored timestamps are ISO-ish UTC strings; the wire uses `YYYY-MM-DD HH:MM:SS`. */
export const datetime = (value: unknown): string | null => {
  if (!value) return null;
  const s = String(value).replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "");
  return s.length === 10 ? `${s} 00:00:00` : s.slice(0, 19);
};
export const isoDatetime = (value: unknown): string | null => {
  const s = datetime(value);
  return s ? `${s.replace(" ", "T")}+00:00` : null;
};

// ------------------------------------------------------------------ ids

/**
 * Newer endpoints identify records by UUID. Batzio's ids are integers, so the
 * UUID carries the table tag and the id: stable, reversible, no extra column.
 */
export function uuidFor(tag: number, id: number | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  const hex = Math.trunc(Number(id)).toString(16).padStart(12, "0");
  return `00000000-0000-8${tag.toString(16).padStart(3, "0")}-8000-${hex}`;
}

export function idFromUuid(value: string | number | null | undefined, tag?: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) return Number(value);
  const m = /^00000000-0000-8([0-9a-f]{3})-8000-([0-9a-f]{12})$/i.exec(String(value));
  if (!m || (tag !== undefined && parseInt(m[1], 16) !== tag)) throw new AppError("not_found", "Record not found.");
  return parseInt(m[2], 16);
}

/** UUID tags, one per kind of record. */
export const TAG = {
  account: 1,
  account_group: 2,
  project: 3,
  bank_account: 4,
  payment: 5,
  bill: 6,
  bill_line: 7,
  outgoing_payment: 8,
  expense: 9,
  employee: 10,
  absence: 11,
  file: 12,
  tax: 13,
  transaction: 14,
  discount: 15,
  journal: 16,
} as const;

export function pathId(call: CompatCall, name: string, tag?: number): number {
  const raw = call.params[name];
  const id = tag === undefined ? Number(raw) : idFromUuid(raw, tag);
  if (!id || !Number.isFinite(id)) throw new AppError("not_found", "Record not found.");
  return id;
}

export function bodyObject(call: CompatCall): Row {
  const b = call.body;
  if (b === null || b === undefined || b === "") return {};
  if (typeof b !== "object" || Array.isArray(b)) throw new AppError("validation", "Expected a JSON object.");
  return b as Row;
}

// ------------------------------------------------------------------ lists

export interface Paging {
  limit: number;
  offset: number;
}

export function paging(query: URLSearchParams, max = 2000, fallback = 500): Paging {
  const limit = Math.min(Math.max(Number(query.get("limit") ?? fallback) || fallback, 1), max);
  const offset = Math.max(Number(query.get("offset") ?? 0) || 0, 0);
  return { limit, offset };
}

/** Page-based paging of the newest endpoints: `page` (1-based) and `limit`/`per-page`. */
export function pagePaging(query: URLSearchParams, fallback = 100): Paging & { page: number } {
  const limit = Math.min(Math.max(Number(query.get("limit") ?? query.get("per-page") ?? fallback) || fallback, 1), 2000);
  const page = Math.max(Number(query.get("page") ?? 1) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

export function pageEnvelope<T>(data: T[], total: number, p: { page: number; limit: number }) {
  return { data, paging: { page: p.page, page_size: p.limit, page_count: Math.max(1, Math.ceil(total / p.limit)), item_count: total } };
}

/** How a wire field is searched and sorted: a column (or SQL expression) plus a value conversion. */
export interface Column {
  sql: string;
  value?: (v: string) => unknown;
}
export type Columns = Record<string, string | Column>;

const col = (c: string | Column): Column => (typeof c === "string" ? { sql: c } : c);

const CRITERIA: Record<string, string> = {
  "=": "=",
  "==": "=",
  equal: "=",
  "!=": "!=",
  not_equal: "!=",
  ">": ">",
  greater_than: ">",
  ">=": ">=",
  greater_equal: ">=",
  "<": "<",
  less_than: "<",
  "<=": "<=",
  less_equal: "<=",
  like: "LIKE",
  not_like: "NOT LIKE",
  is_null: "IS NULL",
  not_null: "IS NOT NULL",
  in: "IN",
  not_in: "NOT IN",
};

/** `[{ field, value, criteria }]` → SQL. Unknown fields are rejected, like the original. */
export function searchWhere(body: unknown, columns: Columns): { sql: string[]; args: unknown[] } {
  if (!Array.isArray(body)) throw new AppError("validation", "Search expects an array of {field, value, criteria}.");
  const sql: string[] = [];
  const args: unknown[] = [];
  for (const raw of body as Row[]) {
    const field = String(raw.field ?? "");
    const target = columns[field];
    if (!target) throw new AppError("validation", "The field {field} cannot be searched.", undefined, { field });
    const c = col(target);
    const op = CRITERIA[String(raw.criteria ?? "=")];
    if (!op) throw new AppError("validation", "Unknown search criteria.");
    // Numbers compare as numbers; text columns convert them back (SQLite affinity).
    const convert = (v: unknown) => (c.value ? c.value(String(v)) : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
    if (op === "IS NULL" || op === "IS NOT NULL") {
      sql.push(`(${c.sql}) ${op}`);
    } else if (op === "IN" || op === "NOT IN") {
      const values = (Array.isArray(raw.value) ? raw.value : String(raw.value ?? "").split(",")).map((v) => convert(String(v).trim()));
      if (!values.length) continue;
      sql.push(`(${c.sql}) ${op} (${values.map(() => "?").join(", ")})`);
      args.push(...values);
    } else if (op === "LIKE" || op === "NOT LIKE") {
      const v = String(raw.value ?? "");
      sql.push(`(${c.sql}) ${op} ?`);
      args.push(v.includes("%") ? v : `%${v}%`);
    } else {
      sql.push(`(${c.sql}) ${op} ?`);
      args.push(convert(raw.value));
    }
  }
  return { sql, args };
}

/** `order_by=name_1_desc,id` → SQL. */
export function orderBy(value: string | null, columns: Columns, fallback = "id"): string {
  const parts: string[] = [];
  for (const token of (value || fallback).split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(.*?)(?:_(asc|desc))?$/.exec(token)!;
    const target = columns[m[1]] ?? (m[1] === "id" ? "id" : null);
    if (!target) continue;
    parts.push(`${col(target).sql} ${m[2] === "desc" ? "DESC" : "ASC"}`);
  }
  if (!parts.length) parts.push("id ASC");
  return parts.join(", ");
}

/** `order=asc|desc` + `sort=<field>` of the newest endpoints. */
export function sortOrder(query: URLSearchParams, columns: Columns, fallback = "id"): string {
  const field = query.get("sort") ?? fallback;
  const dir = (query.get("order") ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";
  return orderBy(`${field}_${dir}`, columns, fallback);
}
