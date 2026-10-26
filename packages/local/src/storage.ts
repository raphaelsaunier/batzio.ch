import type { D1LikeDatabase, D1LikePreparedStatement, D1LikeResult, R2LikeBucket, R2LikeObject } from "@batzio/server/db/types";
import { fromBase64, toBase64 } from "./bytes";
import { host } from "./host-api";

type HostResult = { rows?: Record<string, unknown>[]; changes?: number; lastRowId?: number };

function encodeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return { $bytes: toBase64(value) };
  if (value instanceof ArrayBuffer) return { $bytes: toBase64(new Uint8Array(value)) };
  if (typeof value === "bigint") return Number(value);
  return value;
}

function decodeRow(row: Record<string, unknown>): Record<string, unknown> {
  for (const k in row) {
    const v = row[k] as { $bytes?: string } | null;
    if (v && typeof v === "object" && typeof v.$bytes === "string") row[k] = fromBase64(v.$bytes);
  }
  return row;
}

function parse<T>(text: string): T {
  const value = JSON.parse(text) as T & { error?: string };
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.error === "string") throw new Error(value.error);
  return value;
}

function toD1(r: HostResult): D1LikeResult {
  return { results: (r.rows ?? []).map(decodeRow), success: true, meta: { changes: r.changes ?? 0, last_row_id: r.lastRowId ?? 0 } };
}

class HostStatement implements D1LikePreparedStatement {
  constructor(
    readonly db: string,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1LikePreparedStatement {
    return new HostStatement(this.db, this.sql, values.map(encodeParam));
  }

  private exec(): D1LikeResult {
    return toD1(parse<HostResult>(host().query(this.db, this.sql, JSON.stringify(this.params))));
  }

  async all<T>(): Promise<D1LikeResult<T>> {
    return this.exec() as D1LikeResult<T>;
  }

  async first<T>(): Promise<T | null> {
    return ((this.exec().results?.[0] as T) ?? null) as T | null;
  }

  async run(): Promise<D1LikeResult> {
    return this.exec();
  }
}

/** A D1 database backed by a SQLite file the app manages. */
export class HostDatabase implements D1LikeDatabase {
  constructor(readonly name: string) {}

  prepare(sql: string): D1LikePreparedStatement {
    return new HostStatement(this.name, sql);
  }

  async batch(statements: D1LikePreparedStatement[]): Promise<D1LikeResult[]> {
    const list = statements.map((s) => ({ sql: (s as HostStatement).sql, params: (s as HostStatement).params }));
    return parse<HostResult[]>(host().batch(this.name, JSON.stringify(list))).map(toD1);
  }
}

async function bytesOf(value: ArrayBuffer | Uint8Array | ReadableStream | string): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(await new Response(value).arrayBuffer());
}

/** An R2 bucket backed by a folder the app manages. */
export class HostBucket implements R2LikeBucket {
  async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string, options?: { httpMetadata?: { contentType?: string } }) {
    host().filePut(key, toBase64(await bytesOf(value)), options?.httpMetadata?.contentType ?? "application/octet-stream");
    return { key };
  }

  async get(key: string): Promise<R2LikeObject | null> {
    const text = host().fileGet(key);
    if (!text) return null;
    const { data, type } = JSON.parse(text) as { data: string; type: string };
    const bytes = fromBase64(data);
    return {
      get body() {
        return new Response(bytes as BodyInit).body as ReadableStream;
      },
      httpMetadata: { contentType: type },
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async delete(key: string) {
    host().fileDelete(key);
  }
}
