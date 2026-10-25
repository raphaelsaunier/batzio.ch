import { DatabaseSync } from "node:sqlite";
import type { D1LikeDatabase, D1LikePreparedStatement, D1LikeResult } from "@/lib/server/db/types";

/** In-memory SQLite exposing the subset of the D1 binding API Batzio uses. */
export class SqliteD1 implements D1LikeDatabase {
  readonly db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql: string): D1LikePreparedStatement {
    return new Stmt(this, sql, []);
  }

  async batch(statements: D1LikePreparedStatement[]): Promise<D1LikeResult[]> {
    this.db.exec("BEGIN");
    try {
      const out: D1LikeResult[] = [];
      for (const s of statements) out.push((s as Stmt).runSync());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

class Stmt implements D1LikePreparedStatement {
  constructor(
    private readonly owner: SqliteD1,
    private readonly sql: string,
    private readonly params: unknown[],
  ) {}

  bind(...values: unknown[]): D1LikePreparedStatement {
    return new Stmt(this.owner, this.sql, values);
  }

  private args() {
    return this.params.map((v) => (v === undefined ? null : v)) as never[];
  }

  runSync(): D1LikeResult {
    const stmt = this.owner.db.prepare(this.sql);
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...this.args()) as Record<string, unknown>[];
      return { results: rows, success: true, meta: { changes: 0, last_row_id: 0 } };
    }
    const info = stmt.run(...this.args());
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }

  async all<T>(): Promise<D1LikeResult<T>> {
    const r = this.runSync();
    return r as D1LikeResult<T>;
  }

  async first<T>(): Promise<T | null> {
    const r = this.runSync();
    return ((r.results?.[0] as T) ?? null) as T | null;
  }

  async run(): Promise<D1LikeResult> {
    return this.runSync();
  }
}
