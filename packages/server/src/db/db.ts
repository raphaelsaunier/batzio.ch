import type { D1LikeDatabase, D1LikePreparedStatement } from "./types";

export interface Statement {
  sql: string;
  params?: unknown[];
}

export interface RunResult {
  lastRowId: number;
  changes: number;
}

/** Normalise JS values into something D1 accepts as a bound parameter. */
function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object" && !(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Thin, typed wrapper over a D1-compatible database.
 * All queries use positional `?` parameters.
 */
export class Db {
  constructor(readonly raw: D1LikeDatabase) {}

  private prepare(sql: string, params: unknown[] = []): D1LikePreparedStatement {
    const stmt = this.raw.prepare(sql);
    return params.length ? stmt.bind(...params.map(normalise)) : stmt;
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const res = await this.prepare(sql, params).all<T>();
    return res.results ?? [];
  }

  async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (await this.prepare(sql, params).first<T>()) ?? null;
  }

  async value<T = unknown>(sql: string, ...params: unknown[]): Promise<T | null> {
    const row = await this.first<Record<string, unknown>>(sql, ...params);
    if (!row) return null;
    const key = Object.keys(row)[0];
    return (key === undefined ? null : row[key]) as T | null;
  }

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    const res = await this.prepare(sql, params).run();
    return { lastRowId: Number(res.meta?.last_row_id ?? 0), changes: Number(res.meta?.changes ?? 0) };
  }

  /** Executes statements atomically (D1 batches run as a single transaction). */
  async batch(statements: Statement[]): Promise<RunResult[]> {
    if (statements.length === 0) return [];
    const results = await this.raw.batch(statements.map((s) => this.prepare(s.sql, s.params)));
    return results.map((r) => ({
      lastRowId: Number(r.meta?.last_row_id ?? 0),
      changes: Number(r.meta?.changes ?? 0),
    }));
  }
}

/** Builds `?, ?, ?` for an IN clause. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/** Quotes a SQL identifier. Only call with identifiers from trusted resource definitions. */
export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}
