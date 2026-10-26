import type { D1LikeDatabase, D1LikePreparedStatement, D1LikeResult } from "./types";

/**
 * D1 over the Cloudflare REST API.
 *
 * Used for tenants whose database is not bound to the Worker (for example when
 * the binding pool is exhausted). Slower than a binding and subject to API rate
 * limits, so tenants served this way should be moved to a binding slot on the
 * next deploy. Batches are executed sequentially and are NOT transactional.
 */
export interface D1HttpOptions {
  accountId: string;
  databaseId: string;
  token: string;
  fetch?: typeof fetch;
}

interface ApiQueryResult {
  results?: Record<string, unknown>[];
  success?: boolean;
  meta?: { last_row_id?: number; changes?: number };
}

interface ApiResponse {
  success: boolean;
  errors?: { message: string }[];
  result?: ApiQueryResult[];
}

const API = "https://api.cloudflare.com/client/v4";

export class D1HttpDatabase implements D1LikeDatabase {
  constructor(private readonly options: D1HttpOptions) {}

  async query(sql: string, params: unknown[]): Promise<ApiQueryResult> {
    const doFetch = this.options.fetch ?? fetch;
    const res = await doFetch(
      `${API}/accounts/${this.options.accountId}/d1/database/${this.options.databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      },
    );
    const body = (await res.json()) as ApiResponse;
    if (!res.ok || !body.success) {
      const message = body.errors?.map((e) => e.message).join("; ") || res.statusText;
      throw new Error(`D1 HTTP query failed: ${message}`);
    }
    return body.result?.[0] ?? { results: [] };
  }

  prepare(sql: string): D1LikePreparedStatement {
    return new D1HttpStatement(this, sql, []);
  }

  async batch(statements: D1LikePreparedStatement[]): Promise<D1LikeResult[]> {
    const out: D1LikeResult[] = [];
    for (const stmt of statements) out.push(await stmt.run());
    return out;
  }
}

class D1HttpStatement implements D1LikePreparedStatement {
  constructor(
    private readonly db: D1HttpDatabase,
    private readonly sql: string,
    private readonly params: unknown[],
  ) {}

  bind(...values: unknown[]): D1LikePreparedStatement {
    return new D1HttpStatement(this.db, this.sql, values);
  }

  async all<T>(): Promise<D1LikeResult<T>> {
    const r = await this.db.query(this.sql, this.params);
    return { results: (r.results ?? []) as T[], success: true, meta: r.meta };
  }

  async first<T>(): Promise<T | null> {
    const r = await this.all<T>();
    return r.results?.[0] ?? null;
  }

  async run(): Promise<D1LikeResult> {
    const r = await this.db.query(this.sql, this.params);
    return { results: r.results, success: true, meta: r.meta };
  }
}

/** Creates a new D1 database through the REST API and returns its UUID. */
export async function createD1Database(options: {
  accountId: string;
  token: string;
  name: string;
  locationHint?: string;
}): Promise<string> {
  const res = await fetch(`${API}/accounts/${options.accountId}/d1/database`, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: options.name, primary_location_hint: options.locationHint ?? "weur" }),
  });
  const body = (await res.json()) as { success: boolean; result?: { uuid: string }; errors?: { message: string }[] };
  if (!body.success || !body.result) {
    throw new Error(`Could not create D1 database: ${body.errors?.map((e) => e.message).join("; ")}`);
  }
  return body.result.uuid;
}
