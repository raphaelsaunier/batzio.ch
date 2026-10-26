/**
 * Minimal structural types for the parts of the D1 API Batzio relies on.
 *
 * Keeping these local lets the same data layer run against a real D1 binding,
 * the D1 HTTP API, or an in-memory SQLite database in tests.
 */
export type SqlValue = string | number | null | ArrayBuffer | Uint8Array;

export interface D1ResultMeta {
  last_row_id?: number;
  changes?: number;
  [key: string]: unknown;
}

export interface D1LikeResult<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: D1ResultMeta;
}

export interface D1LikePreparedStatement {
  bind(...values: unknown[]): D1LikePreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1LikeResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1LikeResult>;
}

export interface D1LikeDatabase {
  prepare(sql: string): D1LikePreparedStatement;
  batch(statements: D1LikePreparedStatement[]): Promise<D1LikeResult[]>;
}

export interface R2LikeObject {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2LikeBucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2LikeObject | null>;
  delete(key: string): Promise<void>;
}
