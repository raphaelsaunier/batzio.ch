import { isRole, minRole, type Role } from "@batzio/core/permissions";
import { randomToken, sha256Hex, timingSafeEqual, toBase64Url, uuid } from "./auth/crypto";
import { getMembership, getTenantById, getUser, type TenantRow, type UserRow } from "./control";
import type { Db } from "./db/db";
import { openControlDb } from "./db/connections";
import { getEnv } from "./env";
import { AppError } from "./errors";

/**
 * OAuth 2.1 for the MCP server (authorization code + PKCE, dynamic client
 * registration). An assistant such as Claude or ChatGPT opens a browser, the
 * person approves one company, and the client receives a bearer token. API
 * keys remain for scripts that cannot sign in.
 */

export const OAUTH_ACCESS_PREFIX = "bzo_";

const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 90 * 24 * 60 * 60;
const CODE_TTL_S = 10 * 60;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
};

export class OauthProtocolError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
    this.name = "OauthProtocolError";
  }
}

export interface OauthGrantRow {
  id: string;
  client_id: string;
  client_name: string;
  tenant_id: string;
  user_id: string;
  user_name: string;
  scope: "read" | "write";
  role: Role;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AuthorizeRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string | null;
  resource: string | null;
  scope: "read" | "write";
  /** Host the browser returns to, shown on the consent screen. */
  returnHost: string;
}

export interface VerifiedOauthAccess {
  grantId: string;
  clientName: string;
  tenant: TenantRow;
  user: UserRow;
  role: Role;
  scope: "read" | "write";
}

interface ClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  created_at: string;
}

interface CodeRow {
  id: string;
  client_id: string;
  user_id: string;
  tenant_id: string;
  scope: "read" | "write";
  role: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: string;
  used_at: string | null;
}

const nowIso = () => new Date().toISOString();

export function mcpResource(origin: string) {
  return `${origin}/api/mcp`;
}

/** Public origin: the configured app URL in production, otherwise the request's own. */
export function publicOrigin(request: Request): string {
  const configured = getEnv().APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

export function resourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "write"],
  };
}

export function wwwAuthenticate(origin: string) {
  return `Bearer realm="batzio", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

function protocol(error: OauthProtocolError) {
  return json({ error: error.error, error_description: error.description }, error.status);
}

/** https, or http on a loopback address. No userinfo, no fragment. */
export function isAllowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return url.protocol === "http:" && loopback;
}

/** Exact match, except a loopback client may use any port (RFC 8252). */
export function redirectMatches(registered: string, actual: string): boolean {
  if (registered === actual) return true;
  try {
    const a = new URL(registered);
    const b = new URL(actual);
    const loopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (a.protocol === "http:" && b.protocol === "http:" && loopback(a.hostname) && a.hostname === b.hostname) {
      return a.pathname === b.pathname && a.search === b.search;
    }
  } catch {
    return false;
  }
  return false;
}

function sameResource(value: string | null, origin: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    const expected = new URL(mcpResource(origin));
    return url.origin === expected.origin && url.pathname.replace(/\/$/, "") === expected.pathname;
  } catch {
    return false;
  }
}

function scopeOf(raw: string | null | undefined): "read" | "write" {
  const parts = new Set((raw ?? "").split(/[\s,]+/).filter(Boolean));
  if (parts.has("read") && !parts.has("write")) return "read";
  return "write";
}

async function pkce(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

function safeEqual(a: string, b: string) {
  return timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

function returnHost(uri: string) {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

async function clientById(db: Db, id: string): Promise<ClientRow | null> {
  return db.first<ClientRow>("SELECT * FROM oauth_clients WHERE id = ?", id);
}

function clientUris(row: ClientRow): string[] {
  try {
    const parsed = JSON.parse(row.redirect_uris);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Dynamic client registration (RFC 7591). Public clients only. */
export async function registerOauthClient(db: Db, body: unknown): Promise<Record<string, unknown>> {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((x): x is string => typeof x === "string") : [];
  if (!uris.length || uris.length > 8) throw new OauthProtocolError("invalid_client_metadata", "redirect_uris must list one to eight addresses.");
  if (uris.some((uri) => !isAllowedRedirect(uri))) {
    throw new OauthProtocolError("invalid_client_metadata", "Redirect addresses must be https, or http on localhost.");
  }
  const method = typeof input.token_endpoint_auth_method === "string" ? input.token_endpoint_auth_method : "none";
  if (method !== "none") throw new OauthProtocolError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method=none) are supported.");
  const name = (typeof input.client_name === "string" ? input.client_name : "MCP client").trim().slice(0, 80) || "MCP client";
  const canonical = JSON.stringify([...uris].sort());
  await db.run(
    `INSERT INTO oauth_clients (id, name, redirect_uris) VALUES (?, ?, ?)
     ON CONFLICT(name, redirect_uris) DO NOTHING`,
    uuid(),
    name,
    canonical,
  );
  const row = (await db.first<ClientRow>("SELECT * FROM oauth_clients WHERE name = ? AND redirect_uris = ?", name, canonical))!;
  return clientResponse(row);
}

function clientResponse(row: ClientRow) {
  return {
    client_id: row.id,
    client_id_issued_at: Math.floor(Date.parse(row.created_at) / 1000),
    client_name: row.name,
    redirect_uris: clientUris(row),
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

/**
 * Checks an authorization request. When the redirect address belongs to the
 * client, protocol errors are returned as a redirect; otherwise the consent
 * page shows a message and does not redirect anywhere.
 */
export async function readAuthorizeRequest(db: Db, url: URL): Promise<{ ok: true; request: AuthorizeRequest } | { ok: false; message: string; redirect?: string }> {
  const invalid = { ok: false as const, message: "This connection request is not valid." };
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const client = clientId ? await clientById(db, clientId) : null;
  const matched = client && isAllowedRedirect(redirectUri) ? clientUris(client).find((uri) => redirectMatches(uri, redirectUri)) : undefined;
  const fail = (error: string, description: string) => {
    if (!matched) return invalid;
    const back = new URL(redirectUri);
    back.searchParams.set("error", error);
    back.searchParams.set("error_description", description);
    const state = url.searchParams.get("state");
    if (state) back.searchParams.set("state", state.slice(0, 512));
    return { ok: false as const, message: invalid.message, redirect: back.toString() };
  };
  if (!client || !matched) return invalid;
  if (url.searchParams.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const method = url.searchParams.get("code_challenge_method") || "S256";
  const challenge = url.searchParams.get("code_challenge") ?? "";
  if (method !== "S256" || !CHALLENGE.test(challenge)) return fail("invalid_request", "PKCE S256 is required.");
  const state = url.searchParams.get("state");
  if (state && state.length > 512) return fail("invalid_request", "state is too long.");
  const resource = url.searchParams.get("resource");
  if (resource && !sameResource(resource, url.origin)) return fail("invalid_target", "The resource is not this server.");
  return {
    ok: true,
    request: {
      clientId: client.id,
      clientName: client.name,
      redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      state,
      resource,
      scope: scopeOf(url.searchParams.get("scope")),
      returnHost: returnHost(redirectUri),
    },
  };
}

/** The person approved the request. Returns the client's redirect, with a one-time code. */
export async function approveOauth(
  db: Db,
  input: {
    userId: string;
    origin: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    state: string | null;
    resource: string | null;
    tenantSlug: string;
    scope: string;
    role: string;
  },
): Promise<string> {
  const url = new URL("/oauth/authorize", input.origin);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", input.codeChallengeMethod || "S256");
  if (input.state) url.searchParams.set("state", input.state);
  if (input.resource) url.searchParams.set("resource", input.resource);
  url.searchParams.set("scope", input.scope);
  const checked = await readAuthorizeRequest(db, url);
  if (!checked.ok) {
    if (checked.redirect) return checked.redirect;
    throw new AppError("validation", "This connection request is not valid.");
  }
  if (!isRole(input.role)) throw new AppError("validation", "Unknown role.");
  const scope = input.scope === "read" ? "read" : "write";
  const membership = await getMembership(db, input.userId, input.tenantSlug);
  if (!membership) throw new AppError("forbidden", "You are not a member of this company.");
  const role = minRole(input.role, membership.role);
  const client = (await clientById(db, checked.request.clientId))!;
  const raw = `bzc_${randomToken(32)}`;
  const expires = new Date(Date.now() + CODE_TTL_S * 1000).toISOString();
  await db.run(
    `INSERT INTO oauth_codes (id, client_id, user_id, tenant_id, scope, role, redirect_uri, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    await sha256Hex(raw),
    client.id,
    input.userId,
    membership.tenant.id,
    scope,
    role,
    checked.request.redirectUri,
    checked.request.codeChallenge,
    expires,
  );
  const back = new URL(checked.request.redirectUri);
  back.searchParams.set("code", raw);
  if (checked.request.state) back.searchParams.set("state", checked.request.state);
  return back.toString();
}

/** Builds the access-denied redirect when the redirect address is one the client registered. */
export async function denyOauth(db: Db, url: URL): Promise<string | null> {
  const checked = await readAuthorizeRequest(db, url);
  if (checked.ok) {
    const back = new URL(checked.request.redirectUri);
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("error_description", "The request was denied.");
    if (checked.request.state) back.searchParams.set("state", checked.request.state);
    return back.toString();
  }
  return checked.redirect ?? null;
}

async function issuePair(db: Db, grantId: string) {
  const access = `${OAUTH_ACCESS_PREFIX}${randomToken(32)}`;
  const refresh = `bzr_${randomToken(32)}`;
  const now = Date.now();
  await db.batch([
    {
      sql: "INSERT INTO oauth_tokens (id, grant_id, kind, expires_at) VALUES (?, ?, 'access', ?)",
      params: [await sha256Hex(access), grantId, new Date(now + ACCESS_TTL_S * 1000).toISOString()],
    },
    {
      sql: "INSERT INTO oauth_tokens (id, grant_id, kind, expires_at) VALUES (?, ?, 'refresh', ?)",
      params: [await sha256Hex(refresh), grantId, new Date(now + REFRESH_TTL_S * 1000).toISOString()],
    },
  ]);
  return { access_token: access, token_type: "Bearer" as const, expires_in: ACCESS_TTL_S, refresh_token: refresh };
}

async function replaceGrant(
  db: Db,
  input: { clientId: string; clientName: string; tenantId: string; userId: string; scope: "read" | "write"; role: string },
) {
  const previous = await db.all<{ id: string }>(
    "SELECT id FROM oauth_grants WHERE tenant_id = ? AND user_id = ? AND client_name = ? AND revoked_at IS NULL",
    input.tenantId,
    input.userId,
    input.clientName,
  );
  const id = uuid();
  const statements = previous.flatMap((row) => [
    { sql: "UPDATE oauth_grants SET revoked_at = ? WHERE id = ?", params: [nowIso(), row.id] },
    { sql: "UPDATE oauth_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL", params: [nowIso(), row.id] },
  ]);
  statements.push({
    sql: `INSERT INTO oauth_grants (id, client_id, client_name, tenant_id, user_id, scope, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [id, input.clientId, input.clientName, input.tenantId, input.userId, input.scope, input.role],
  });
  await db.batch(statements);
  return id;
}

async function tokenResponseFor(db: Db, grantId: string, scope: string) {
  const pair = await issuePair(db, grantId);
  return { ...pair, scope };
}

async function exchangeCode(db: Db, origin: string, form: URLSearchParams) {
  const code = form.get("code") ?? "";
  const clientId = form.get("client_id") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  const resource = form.get("resource");
  if (!code || !clientId || !redirectUri || !verifier) throw new OauthProtocolError("invalid_request", "code, client_id, redirect_uri and code_verifier are required.");
  if (!sameResource(resource, origin)) throw new OauthProtocolError("invalid_target", "The resource is not this server.", 400);
  if (!VERIFIER.test(verifier)) throw new OauthProtocolError("invalid_grant", "code_verifier is not valid.");
  const row = await db.first<CodeRow>("SELECT * FROM oauth_codes WHERE id = ?", await sha256Hex(code));
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) throw new OauthProtocolError("invalid_grant", "The authorization code is invalid or has expired.");
  if (row.client_id !== clientId || row.redirect_uri !== redirectUri) throw new OauthProtocolError("invalid_grant", "The authorization code does not match this client.");
  const expected = await pkce(verifier);
  if (!safeEqual(expected, row.code_challenge)) throw new OauthProtocolError("invalid_grant", "PKCE verification failed.");
  const spent = await db.run("UPDATE oauth_codes SET used_at = ? WHERE id = ? AND used_at IS NULL", nowIso(), row.id);
  if (!spent.changes) throw new OauthProtocolError("invalid_grant", "The authorization code is invalid or has expired.");
  const client = await clientById(db, clientId);
  if (!client) throw new OauthProtocolError("invalid_client", "Unknown client.", 401);
  const grantId = await replaceGrant(db, {
    clientId,
    clientName: client.name,
    tenantId: row.tenant_id,
    userId: row.user_id,
    scope: row.scope,
    role: row.role,
  });
  return tokenResponseFor(db, grantId, row.scope);
}

async function refresh(db: Db, form: URLSearchParams) {
  const raw = form.get("refresh_token") ?? "";
  const clientId = form.get("client_id") ?? "";
  if (!raw || !clientId) throw new OauthProtocolError("invalid_request", "refresh_token and client_id are required.");
  const token = await db.first<{ id: string; grant_id: string; expires_at: string; revoked_at: string | null }>(
    "SELECT id, grant_id, expires_at, revoked_at FROM oauth_tokens WHERE id = ? AND kind = 'refresh'",
    await sha256Hex(raw),
  );
  if (!token || token.revoked_at || Date.parse(token.expires_at) < Date.now()) throw new OauthProtocolError("invalid_grant", "The refresh token is invalid or has expired.");
  const grant = await db.first<{ id: string; client_id: string; scope: string; revoked_at: string | null }>(
    "SELECT id, client_id, scope, revoked_at FROM oauth_grants WHERE id = ?",
    token.grant_id,
  );
  if (!grant || grant.revoked_at || grant.client_id !== clientId) throw new OauthProtocolError("invalid_grant", "The refresh token is no longer valid.");
  await db.run("UPDATE oauth_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL", nowIso(), grant.id);
  return tokenResponseFor(db, grant.id, grant.scope);
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const text = await request.text();
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    let body: unknown = {};
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new OauthProtocolError("invalid_request", "The request body is not valid JSON.");
    }
    const params = new URLSearchParams();
    if (body && typeof body === "object") {
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
        else if (value != null) params.set(key, String(value));
      }
    }
    return params;
  }
  return new URLSearchParams(text);
}

async function revokeToken(db: Db, form: URLSearchParams) {
  const raw = form.get("token") ?? "";
  if (!raw) return;
  const token = await db.first<{ grant_id: string }>("SELECT grant_id FROM oauth_tokens WHERE id = ?", await sha256Hex(raw));
  if (!token) return;
  const now = nowIso();
  await db.batch([
    { sql: "UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", params: [now, token.grant_id] },
    { sql: "UPDATE oauth_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL", params: [now, token.grant_id] },
  ]);
}

/** Metadata, registration, token and revocation. Authorization itself is the consent page. */
export async function handleOauthHttp(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const known =
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/api/mcp" ||
    path === "/.well-known/oauth-authorization-server" ||
    path === "/oauth/register" ||
    path === "/oauth/token" ||
    path === "/oauth/revoke";
  if (!known) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const origin = publicOrigin(request);
  try {
    if (request.method === "GET" && (path === "/.well-known/oauth-protected-resource" || path.endsWith("/api/mcp"))) {
      return json(resourceMetadata(origin));
    }
    if (request.method === "GET" && path === "/.well-known/oauth-authorization-server") return json(authorizationServerMetadata(origin));
    if (path === "/oauth/register") {
      if (request.method !== "POST") return json({ error: "invalid_request", error_description: "Use POST." }, 405);
      const body = await request.json().catch(() => null);
      return json(await registerOauthClient(await control(), body), 201);
    }
    if (path === "/oauth/token") {
      if (request.method !== "POST") return json({ error: "invalid_request", error_description: "Use POST." }, 405);
      const form = await readForm(request);
      const grant = form.get("grant_type");
      const db = await control();
      if (grant === "authorization_code") return json(await exchangeCode(db, origin, form));
      if (grant === "refresh_token") return json(await refresh(db, form));
      throw new OauthProtocolError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
    }
    if (path === "/oauth/revoke") {
      if (request.method !== "POST") return json({ error: "invalid_request", error_description: "Use POST." }, 405);
      await revokeToken(await control(), await readForm(request));
      return new Response(null, { status: 200, headers: CORS });
    }
    return json({ error: "invalid_request", error_description: "Method not allowed." }, 405);
  } catch (error) {
    if (error instanceof OauthProtocolError) return protocol(error);
    console.error("oauth failed", error);
    return json({ error: "server_error", error_description: "Something went wrong." }, 500);
  }
}

const control = () => openControlDb(getEnv());

export async function verifyOauthAccessToken(db: Db, raw: string): Promise<VerifiedOauthAccess | null> {
  if (!raw.startsWith(OAUTH_ACCESS_PREFIX)) return null;
  const token = await db.first<{ grant_id: string; expires_at: string; revoked_at: string | null }>(
    "SELECT grant_id, expires_at, revoked_at FROM oauth_tokens WHERE id = ? AND kind = 'access'",
    await sha256Hex(raw),
  );
  if (!token || token.revoked_at || Date.parse(token.expires_at) < Date.now()) return null;
  const grant = await db.first<{ id: string; client_name: string; tenant_id: string; user_id: string; scope: string; role: string; revoked_at: string | null; last_used_at: string | null }>(
    "SELECT * FROM oauth_grants WHERE id = ?",
    token.grant_id,
  );
  if (!grant || grant.revoked_at) return null;
  const [tenant, user] = await Promise.all([getTenantById(db, grant.tenant_id), getUser(db, grant.user_id)]);
  if (!tenant || tenant.status !== "active" || !user) return null;
  const membership = await db.value<string>("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?", tenant.id, user.id);
  if (!membership || !isRole(membership)) return null;
  const role = minRole(isRole(grant.role) ? grant.role : "viewer", membership);
  if (!grant.last_used_at || Date.now() - Date.parse(grant.last_used_at) > 60_000) {
    await db.run("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?", nowIso(), grant.id);
  }
  return {
    grantId: grant.id,
    clientName: grant.client_name,
    tenant,
    user,
    role,
    scope: grant.scope === "read" ? "read" : "write",
  };
}

export async function listOauthGrants(db: Db, tenantId: string): Promise<OauthGrantRow[]> {
  return db.all<OauthGrantRow>(
    `SELECT oauth_grants.*, users.name AS user_name FROM oauth_grants
     JOIN users ON users.id = oauth_grants.user_id
     WHERE oauth_grants.tenant_id = ? AND oauth_grants.revoked_at IS NULL
     ORDER BY oauth_grants.created_at DESC`,
    tenantId,
  );
}

export async function revokeOauthGrant(db: Db, tenantId: string, id: string) {
  const now = nowIso();
  await db.batch([
    { sql: "UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL", params: [now, id, tenantId] },
    { sql: "UPDATE oauth_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL", params: [now, id] },
  ]);
}
