import { beforeAll, describe, expect, it } from "vitest";
import { handleApiRequest } from "../src/http";
import { MemoryBucket } from "./helpers/memory-bucket";
import { SqliteD1 } from "./helpers/sqlite-d1";
import { env } from "./helpers/workers-env";

/**
 * The whole HTTP surface in-process, as the Workers serve it: sign-up and
 * sessions, tenant routing, REST, API keys and their scopes, retry-safe
 * requests, history and undo, duplicates, OpenAPI and MCP.
 */

const BASE = "https://batzio.test";

interface Call {
  token?: string;
  tenant?: string;
  json?: unknown;
  headers?: Record<string, string>;
  locale?: string;
}

async function call(method: string, path: string, opts: Call = {}) {
  const headers: Record<string, string> = { "accept-language": opts.locale ?? "en", "user-agent": "vitest", ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.tenant) headers["x-tenant"] = opts.tenant;
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  const response = (await handleApiRequest(new Request(`${BASE}${path}`, { method, headers, body: opts.json === undefined ? undefined : JSON.stringify(opts.json) })))!;
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, headers: response.headers, text, json };
}

let token = "";
const tenant = "muster-gmbh";

beforeAll(async () => {
  Object.assign(env, { DB: new SqliteD1(), TENANT_DB_001: new SqliteD1(), TENANT_DB_002: new SqliteD1(), FILES: new MemoryBucket() });
  const signup = await call("POST", "/api/v1/auth/signup", {
    json: { name: "Anna Muster", email: "anna@example.ch", password: "correct horse battery", company: "Muster GmbH", language: "de", demo: true },
  });
  expect(signup.status, signup.text).toBe(200);
  token = signup.json.data.token;
});

describe("HTTP API", () => {
  it("signs in, knows who is asking and keeps companies apart", async () => {
    const me = await call("GET", "/api/v1/auth/me", { token });
    expect(me.json.data.companies.map((c: { slug: string }) => c.slug)).toEqual([tenant]);
    expect((await call("GET", "/api/v1/auth/me")).status).toBe(401);
    expect((await call("GET", "/api/v1/invoices", { token, tenant: "someone-else" })).status).toBe(403);
    expect((await call("GET", "/api/v1/invoices", { token })).status).toBe(422);
  });

  it("serves REST with documents, workflow steps and PDFs", async () => {
    const contact = await call("POST", "/api/v1/contacts", { token, tenant, json: { type: "company", name_1: "Bergsicht Hotels AG" } });
    expect(contact.status).toBe(201);
    const invoice = await call("POST", "/api/v1/invoices", { token, tenant, json: { contact_id: contact.json.data.id, positions: [{ type: "custom", text: "Workshop", quantity: 4, unit_price: 180 }] } });
    expect(invoice.json.data.total).toBe(778.3);
    const id = invoice.json.data.id;
    expect((await call("POST", `/api/v1/invoices/${id}/issue`, { token, tenant, json: {} })).json.data.record.status).toBe("open");
    const locked = await call("PATCH", `/api/v1/invoices/${id}`, { token, tenant, json: { title: "Changed" } });
    expect(locked.status).toBe(409);
    const pdf = await call("GET", `/api/v1/invoices/${id}/pdf`, { token, tenant });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((await call("GET", "/api/v1/invoices/999999", { token, tenant })).status).toBe(404);
  });

  it("answers in the caller's language", async () => {
    const error = await call("GET", "/api/v1/invoices/999999", { token, tenant, locale: "fr" });
    expect(error.json.error.message).not.toMatch(/not found/i);
  });

  it("honours API key scopes and records which key acted", async () => {
    const issued = await call("POST", "/api/v1/app/api-keys", { token, tenant, json: { name: "Reporting", scope: "read", role: "admin" } });
    expect(issued.status, issued.text).toBe(200);
    const key = issued.json.data.token ?? issued.json.data.key;
    expect((await call("GET", "/api/v1/contacts", { token: key })).status).toBe(200);
    expect((await call("POST", "/api/v1/contacts", { token: key, json: { type: "company", name_1: "Nope AG" } })).status).toBe(403);
  });

  it("answers a retried write once and refuses a reused key elsewhere", async () => {
    const headers = { "idempotency-key": "8f0c1a8e-0b8f-4d1a-9e0e-1d6c2b7d1a11" };
    const first = await call("POST", "/api/v1/contacts", { token, tenant, headers, json: { type: "company", name_1: "Once Only AG" } });
    const second = await call("POST", "/api/v1/contacts", { token, tenant, headers, json: { type: "company", name_1: "Once Only AG" } });
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(second.json.data.id).toBe(first.json.data.id);
    const elsewhere = await call("POST", "/api/v1/projects", { token, tenant, headers, json: { name: "x" } });
    expect(elsewhere.status).toBe(422);
    const failed = await call("POST", "/api/v1/contacts", { token, tenant, headers: { "idempotency-key": "invalid-once" }, json: { type: "company" } });
    expect(failed.status).toBe(422);
    const retried = await call("POST", "/api/v1/contacts", { token, tenant, headers: { "idempotency-key": "invalid-once" }, json: { type: "company", name_1: "Fixed AG" } });
    expect(retried.status).toBe(201);
  });

  it("explains history with provenance, and undoes", async () => {
    const created = await call("POST", "/api/v1/contacts", { token, tenant, json: { type: "company", name_1: "History AG" } });
    const id = created.json.data.id;
    await call("PATCH", `/api/v1/contacts/${id}`, { token, tenant, json: { email: "info@history.ch" } });
    const history = await call("GET", `/api/v1/app/history/contacts/${id}`, { token, tenant });
    const [change, creation] = history.json.data;
    expect(change).toMatchObject({ action: "update", actor: { automated: false, source: "app" }, device: null, undo: { possible: true } });
    expect(creation.action).toBe("create");
    const entry = await call("GET", `/api/v1/app/audit/${change.id}`, { token, tenant });
    expect(entry.json.data.changes[0]).toMatchObject({ field: "email", kind: "changed", to: "info@history.ch" });
    expect((await call("POST", `/api/v1/audit_log/${change.id}/undo`, { token, tenant, json: {} })).status).toBe(200);
    expect((await call("GET", `/api/v1/contacts/${id}`, { token, tenant })).json.data.email).toBeNull();
    expect((await call("POST", `/api/v1/audit_log/${change.id}/undo`, { token, tenant, json: {} })).status).toBe(409);
  });

  it("finds and lists possible duplicates", async () => {
    await call("POST", "/api/v1/contacts", { token, tenant, json: { type: "company", name_1: "Twice AG", email: "twice@example.ch" } });
    await call("POST", "/api/v1/contacts", { token, tenant, json: { type: "company", name_1: "Twice", email: "twice@example.ch" } });
    const list = await call("GET", "/api/v1/duplicates?status=open", { token, tenant });
    expect(list.json.data.some((d: { reason: string }) => d.reason === "same_email")).toBe(true);
    const scan = await call("POST", "/api/v1/app/duplicates/scan", { token, tenant, json: {} });
    expect(scan.status).toBe(200);
  });

  it("documents every operation in OpenAPI", async () => {
    const doc = await call("GET", "/api/v1/openapi.json");
    const paths = Object.keys(doc.json.paths);
    expect(paths).toEqual(expect.arrayContaining(["/app/history/{resource}/{id}", "/app/audit/{id}", "/app/duplicates/scan", "/audit_log/{id}/undo"]));
  });

  it("lets AI agents work over MCP, and names the client in the audit log", async () => {
    const key = (await call("POST", "/api/v1/app/api-keys", { token, tenant, json: { name: "Claude", scope: "write", role: "admin" } })).json.data;
    const mcp = (body: unknown) =>
      handleApiRequest(
        new Request(`${BASE}/api/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${key.token ?? key.key}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
          body: JSON.stringify(body),
        }),
      );
    const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Claude Desktop", version: "1.0" } } });
    expect(init!.status).toBe(200);
    const tools = await (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }))!.json();
    expect(tools.result.tools.length).toBeGreaterThan(20);
    const done = await (await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_record", arguments: { resource: "contacts", data: { type: "company", name_1: "Via MCP AG" } } } }))!.json();
    expect(done.result.isError ?? false, JSON.stringify(done)).toBe(false);
    const audit = await call("GET", "/api/v1/audit_log?source=mcp", { token, tenant });
    const [entry] = audit.json.data;
    expect(entry.source).toBe("mcp");
    const history = await call("GET", `/api/v1/app/audit/${entry.id}`, { token, tenant });
    expect(history.json.data.actor.automated).toBe(true);
    expect(history.json.data.provenance[0]).toMatchObject({ label: "MCP" });
  });
});
