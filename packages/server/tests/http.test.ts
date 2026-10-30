import { beforeAll, describe, expect, it } from "vitest";
import { toBase64Url } from "../src/auth/crypto";
import { openControlDb } from "../src/db/connections";
import { getEnv } from "../src/env";
import { handleApiRequest } from "../src/http";
import { approveOauth } from "../src/oauth";
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

  it("lets an assistant connect over OAuth instead of a pasted key", async () => {
    const anon = await handleApiRequest(
      new Request(`${BASE}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: "{}",
      }),
    );
    expect(anon!.status).toBe(401);
    expect(anon!.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/api/mcp");

    const protectedResource = await call("GET", "/.well-known/oauth-protected-resource");
    expect(protectedResource.json).toMatchObject({ resource: `${BASE}/api/mcp`, authorization_servers: [BASE] });
    const server = await call("GET", "/.well-known/oauth-authorization-server");
    expect(server.json.authorization_endpoint).toBe(`${BASE}/oauth/authorize`);
    expect(server.json.code_challenge_methods_supported).toEqual(["S256"]);

    const bad = await call("POST", "/oauth/register", { json: { client_name: "Nope", redirect_uris: ["http://evil.example/callback"] } });
    expect(bad.status).toBe(400);

    const redirect = "http://127.0.0.1:8787/callback";
    const registered = await call("POST", "/oauth/register", {
      json: { client_name: "Claude", redirect_uris: [redirect], token_endpoint_auth_method: "none" },
    });
    expect(registered.status).toBe(201);
    const clientId = registered.json.client_id as string;
    const again = await call("POST", "/oauth/register", { json: { client_name: "Claude", redirect_uris: [redirect] } });
    expect(again.json.client_id).toBe(clientId);

    const verifier = "a".repeat(64);
    const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const userId = (await call("GET", "/api/v1/auth/me", { token })).json.data.user.id as string;
    const usedRedirect = "http://127.0.0.1:53211/callback";
    const back = new URL(
      await approveOauth(await openControlDb(getEnv()), {
        userId,
        origin: BASE,
        clientId,
        redirectUri: usedRedirect,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        state: "xyz",
        resource: `${BASE}/api/mcp`,
        tenantSlug: tenant,
        scope: "write",
        role: "admin",
      }),
    );
    expect(back.origin + back.pathname).toBe("http://127.0.0.1:53211/callback");
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;

    const wrong = await call("POST", "/oauth/token", {
      json: { grant_type: "authorization_code", code, redirect_uri: usedRedirect, client_id: clientId, code_verifier: "b".repeat(64) },
    });
    expect(wrong.status).toBe(400);
    const traded = await call("POST", "/oauth/token", {
      json: { grant_type: "authorization_code", code, redirect_uri: usedRedirect, client_id: clientId, code_verifier: verifier, resource: `${BASE}/api/mcp` },
    });
    expect(traded.status, traded.text).toBe(200);
    expect(traded.json.token_type).toBe("Bearer");
    expect(traded.json.access_token).toMatch(/^bzo_/);
    const reused = await call("POST", "/oauth/token", {
      json: { grant_type: "authorization_code", code, redirect_uri: usedRedirect, client_id: clientId, code_verifier: verifier },
    });
    expect(reused.status).toBe(400);

    const access = traded.json.access_token as string;
    const mcp = (bearer: string, body: unknown) =>
      handleApiRequest(
        new Request(`${BASE}/api/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
          body: JSON.stringify(body),
        }),
      );
    const created = await (await mcp(access, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_record", arguments: { resource: "contacts", data: { type: "company", name_1: "OAuth AG" } } } }))!.json();
    expect(created.result.isError ?? false, JSON.stringify(created)).toBe(false);

    const refreshed = await call("POST", "/oauth/token", { json: { grant_type: "refresh_token", refresh_token: traded.json.refresh_token, client_id: clientId } });
    expect(refreshed.status).toBe(200);
    expect((await mcp(access, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }))!.status).toBe(401);
    const listed = await (await mcp(refreshed.json.access_token, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }))!.json();
    expect(listed.result.tools.length).toBeGreaterThan(20);

    expect((await call("POST", "/oauth/revoke", { json: { token: refreshed.json.refresh_token } })).status).toBe(200);
    expect((await mcp(refreshed.json.access_token, { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }))!.status).toBe(401);

    const reader = await call("POST", "/oauth/register", { json: { client_name: "Reporter", redirect_uris: ["https://reporter.example/callback"] } });
    const readBack = new URL(
      await approveOauth(await openControlDb(getEnv()), {
        userId,
        origin: BASE,
        clientId: reader.json.client_id,
        redirectUri: "https://reporter.example/callback",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        state: null,
        resource: null,
        tenantSlug: tenant,
        scope: "read",
        role: "admin",
      }),
    );
    const readToken = await call("POST", "/oauth/token", {
      json: {
        grant_type: "authorization_code",
        code: readBack.searchParams.get("code"),
        redirect_uri: "https://reporter.example/callback",
        client_id: reader.json.client_id,
        code_verifier: verifier,
      },
    });
    const denied = await (await mcp(readToken.json.access_token, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "create_record", arguments: { resource: "contacts", data: { type: "company", name_1: "Nope" } } } }))!.json();
    expect(denied.result.isError).toBe(true);
  });
});
