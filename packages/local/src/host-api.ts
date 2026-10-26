/**
 * What a native app provides to the engine, as `globalThis.__batzio_host`.
 * Every call is synchronous and passes strings only (JSON or base64), so the
 * same contract works across JavaScriptCore, V8 (ClearScript) and a WebView's
 * JavaScript bridge.
 */
export interface Host {
  /**
   * Runs one statement against a database (`DB` for the control plane,
   * `TENANT_DB_001`… per company). `params` is a JSON array; byte values are
   * `{"$bytes": "<base64>"}`. Returns `{"rows": [...], "changes": n, "lastRowId": n}`
   * or `{"error": "<SQLite message>"}`.
   */
  query(db: string, sql: string, params: string): string;
  /** Runs `[{sql, params}]` in one transaction; returns an array of results or `{"error"}`. */
  batch(db: string, statements: string): string;
  /** `{"data": "<base64>", "type": "<content type>"}` or null. */
  fileGet(key: string): string | null;
  filePut(key: string, data: string, type: string): void;
  fileDelete(key: string): void;
  /** `n` cryptographically random bytes, base64. */
  random(n: number): string;
  /** Optional native SHA-256 (base64 in, base64 out); the engine has a JavaScript fallback. */
  sha256?(data: string): string;
  /** Optional native PBKDF2-HMAC-SHA256: password and salt base64, `bits` long result in base64. */
  pbkdf2?(password: string, salt: string, iterations: number, bits: number): string;
  log(level: string, message: string): void;
  /** Receives the response (JSON) of `BatzioLocal.dispatch(id, …)`. */
  respond(id: string, response: string): void;
}

export function host(): Host {
  const h = (globalThis as { __batzio_host?: Host }).__batzio_host;
  if (!h) throw new Error("The Batzio host bridge (__batzio_host) is missing.");
  return h;
}
