import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

export const BUNDLE = new URL("../../bundle/batzio-local.js", import.meta.url);
export const ORIGIN = "https://device.batzio.local";

type Row = Record<string, unknown>;

export interface WireResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

/**
 * The host a native app provides, in Node: SQLite through node:sqlite and files
 * in a map. `bare` runs the bundle in an empty V8 context (no web APIs, like
 * JavaScriptCore or ClearScript); otherwise in Node's own realm (like a WebView).
 */
export function createEngine({ bare = true, nativeCrypto = true } = {}) {
  const dbs = new Map<string, DatabaseSync>();
  const files = new Map<string, { data: string; type: string }>();
  const waiting = new Map<string, (r: string) => void>();
  const logs: string[] = [];
  const statements: string[] = [];

  const open = (name: string) => {
    let db = dbs.get(name);
    if (!db) {
      db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys = ON");
      dbs.set(name, db);
    }
    return db;
  };
  const decode = (v: unknown) => (v && typeof v === "object" && "$bytes" in (v as Row) ? Buffer.from(String((v as Row).$bytes), "base64") : v);
  const encodeRow = (row: Row) => {
    for (const k of Object.keys(row)) if (row[k] instanceof Uint8Array) row[k] = { $bytes: Buffer.from(row[k] as Uint8Array).toString("base64") };
    return row;
  };
  const exec = (db: DatabaseSync, sql: string, params: unknown[]) => {
    statements.push(sql);
    const stmt = db.prepare(sql);
    const args = params.map(decode) as never[];
    if (stmt.columns().length > 0) {
      const rows = (stmt.all(...args) as Row[]).map(encodeRow);
      const changes = /^\s*(select|with|pragma)\b/i.test(sql) ? 0 : Number((db.prepare("SELECT changes() AS c").get() as Row).c);
      return { rows, changes, lastRowId: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], changes: Number(info.changes), lastRowId: Number(info.lastInsertRowid) };
  };

  const host = {
    query(db: string, sql: string, params: string) {
      try {
        return JSON.stringify(exec(open(db), sql, JSON.parse(params)));
      } catch (e) {
        return JSON.stringify({ error: (e as Error).message });
      }
    },
    batch(db: string, list: string) {
      const conn = open(db);
      conn.exec("BEGIN");
      try {
        const out = (JSON.parse(list) as { sql: string; params: unknown[] }[]).map((s) => exec(conn, s.sql, s.params));
        conn.exec("COMMIT");
        return JSON.stringify(out);
      } catch (e) {
        conn.exec("ROLLBACK");
        return JSON.stringify({ error: (e as Error).message });
      }
    },
    fileGet: (key: string) => (files.has(key) ? JSON.stringify(files.get(key)) : null),
    filePut: (key: string, data: string, type: string) => void files.set(key, { data, type }),
    fileDelete: (key: string) => void files.delete(key),
    random: (n: number) => randomBytes(n).toString("base64"),
    ...(nativeCrypto
      ? {
          sha256: (b64: string) => createHash("sha256").update(Buffer.from(b64, "base64")).digest("base64"),
          pbkdf2: (pw: string, salt: string, iterations: number, bits: number) =>
            pbkdf2Sync(Buffer.from(pw, "base64"), Buffer.from(salt, "base64"), iterations, bits / 8, "sha256").toString("base64"),
        }
      : {}),
    log: (level: string, message: string) => void logs.push(`${level}: ${message}`),
    respond: (id: string, response: string) => {
      waiting.get(id)?.(response);
      waiting.delete(id);
    },
  };

  const code = readFileSync(BUNDLE, "utf8");
  let run: (source: string) => unknown;
  if (bare) {
    const context = vm.createContext({ __batzio_host: host }, { microtaskMode: "afterEvaluate" });
    run = (source) => vm.runInContext(source, context);
  } else {
    (globalThis as Row).__batzio_host = host;
    run = (source) => vm.runInThisContext(source);
  }
  run(code);
  run(`BatzioLocal.configure(${JSON.stringify(JSON.stringify({ tenantSlots: 4 }))})`);

  let next = 0;
  /** Sends one request; `settledSynchronously` tells whether the answer came before dispatch returned (as JavaScriptCore needs). */
  async function request(method: string, path: string, options: { token?: string; tenant?: string; json?: unknown; body?: Uint8Array; contentType?: string; locale?: string; headers?: [string, string][] } = {}) {
    const id = String(++next);
    const headers: [string, string][] = [["accept", "application/json"], ["accept-language", options.locale ?? "en"]];
    if (options.token) headers.push(["authorization", `Bearer ${options.token}`]);
    if (options.tenant) headers.push(["x-tenant", options.tenant]);
    if (options.headers) headers.push(...options.headers);
    let body: string | null = null;
    if (options.json !== undefined) {
      headers.push(["content-type", "application/json"]);
      body = Buffer.from(JSON.stringify(options.json)).toString("base64");
    } else if (options.body) {
      headers.push(["content-type", options.contentType ?? "application/octet-stream"]);
      body = Buffer.from(options.body).toString("base64");
    }
    let settled = false;
    const answer = new Promise<string>((resolve) =>
      waiting.set(id, (r) => {
        settled = true;
        resolve(r);
      }),
    );
    run(`BatzioLocal.dispatch(${JSON.stringify(id)}, ${JSON.stringify(JSON.stringify({ method, url: `${ORIGIN}${path}`, headers, body }))})`);
    const settledSynchronously = settled;
    const wire = JSON.parse(await answer) as WireResponse;
    const bytes = Buffer.from(wire.body, "base64");
    const header = (name: string) => wire.headers.find(([k]) => k === name)?.[1] ?? null;
    return {
      status: wire.status,
      header,
      bytes,
      settledSynchronously,
      json: () => JSON.parse(bytes.toString("utf8")) as any,
    };
  }

  return { request, logs, statements, files, dbs };
}

/** A multipart body like the apps send for uploads. */
export function multipart(parts: { name: string; filename?: string; type?: string; data: string | Uint8Array }[]) {
  const boundary = "batzio-test-boundary";
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = `form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ""}`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ""}\r\n`));
    chunks.push(Buffer.from(p.data));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: new Uint8Array(Buffer.concat(chunks)), contentType: `multipart/form-data; boundary=${boundary}` };
}
