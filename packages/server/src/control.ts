import { isRole, minRole, type Role } from "@batzio/core/permissions";
import { hashPassword, randomToken, sha256Hex, uuid, verifyPassword } from "./auth/crypto";
import type { DatabaseAllocation } from "./db/connections";
import type { Db } from "./db/db";
import { AppError } from "./errors";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  locale: string;
  is_superadmin: number;
  last_login_at: string | null;
  created_at: string;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  db_strategy: string;
  db_binding: string | null;
  d1_database_id: string | null;
  locale: string;
  created_at: string;
  inbox_token?: string | null;
}

export interface Membership {
  tenant: TenantRow;
  role: Role;
}

export interface ApiKeyRow {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  role: Role;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export const SESSION_TTL_DAYS = 30;

const RESERVED_SLUGS = new Set([
  "api", "app", "admin", "docs", "login", "logout", "signup", "select", "settings", "static",
  "assets", "_next", "mcp", "help", "status", "www", "new", "invite", "account", "favicon.ico", "pricing",
]);

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return "Use 3–40 lowercase letters, digits or dashes.";
  if (RESERVED_SLUGS.has(slug)) return "This address is reserved.";
  return null;
}

const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------- users

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  return db.first<UserRow>("SELECT * FROM users WHERE email = ?", email.trim());
}

export async function getUser(db: Db, id: string): Promise<UserRow | null> {
  return db.first<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export async function createUser(db: Db, input: { email: string; name: string; password: string; locale?: string }) {
  const email = input.email.trim().toLowerCase();
  if (await findUserByEmail(db, email)) throw new AppError("conflict", "An account with this email already exists.");
  if (input.password.length < 10) throw new AppError("validation", "Password must be at least 10 characters.");
  const id = uuid();
  await db.run(
    "INSERT INTO users (id, email, name, password_hash, locale) VALUES (?, ?, ?, ?, ?)",
    id,
    email,
    input.name.trim(),
    await hashPassword(input.password),
    input.locale ?? "en",
  );
  return (await getUser(db, id))!;
}

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

/** Verifies credentials with a simple fixed-window brute-force limiter. */
export async function authenticate(db: Db, email: string, password: string, ip = "unknown"): Promise<UserRow> {
  const key = `${email.trim().toLowerCase()}|${ip}`;
  const attempt = await db.first<{ count: number; window_start: string }>(
    "SELECT count, window_start FROM login_attempts WHERE key = ?",
    key,
  );
  const inWindow = attempt && Date.now() - Date.parse(attempt.window_start) < WINDOW_MS;
  if (inWindow && attempt!.count >= MAX_ATTEMPTS) {
    throw new AppError("rate_limited", "Too many attempts. Try again in 15 minutes.");
  }

  const user = await findUserByEmail(db, email);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok || !user) {
    await db.run(
      `INSERT INTO login_attempts (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN ? THEN count + 1 ELSE 1 END,
         window_start = CASE WHEN ? THEN window_start ELSE excluded.window_start END`,
      key,
      nowIso(),
      inWindow ? 1 : 0,
      inWindow ? 1 : 0,
    );
    throw new AppError("unauthorized", "Invalid email or password.");
  }
  await db.batch([
    { sql: "DELETE FROM login_attempts WHERE key = ?", params: [key] },
    { sql: "UPDATE users SET last_login_at = ? WHERE id = ?", params: [nowIso(), user.id] },
  ]);
  return user;
}

export async function changePassword(db: Db, userId: string, current: string, next: string) {
  const user = await getUser(db, userId);
  if (!user || !(await verifyPassword(current, user.password_hash))) {
    throw new AppError("validation", "Current password is incorrect.");
  }
  if (next.length < 10) throw new AppError("validation", "Password must be at least 10 characters.");
  await db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", await hashPassword(next), nowIso(), userId);
}

// ---------------------------------------------------------------- sessions

export async function createSession(db: Db, userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await db.run(
    "INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
    await sha256Hex(token),
    userId,
    expires,
    meta.ip ?? null,
    meta.userAgent?.slice(0, 300) ?? null,
  );
  return { token, expires };
}

export async function getSessionUser(db: Db, token: string): Promise<UserRow | null> {
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await db.first<UserRow & { expires_at: string }>(
    `SELECT users.*, sessions.expires_at FROM sessions
     JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?`,
    id,
  );
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    await db.run("DELETE FROM sessions WHERE id = ?", id);
    return null;
  }
  // Sliding expiry: extend sessions that are past half their lifetime.
  if (Date.parse(row.expires_at) - Date.now() < (SESSION_TTL_DAYS / 2) * 86_400_000) {
    const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
    await db.run("UPDATE sessions SET expires_at = ? WHERE id = ?", expires, id);
  }
  return row;
}

export async function deleteSession(db: Db, token: string) {
  await db.run("DELETE FROM sessions WHERE id = ?", await sha256Hex(token));
}

// ------------------------------------------------------- tenants & members

export async function listMemberships(db: Db, userId: string): Promise<Membership[]> {
  const rows = await db.all<TenantRow & { role: string }>(
    `SELECT tenants.*, memberships.role FROM memberships
     JOIN tenants ON tenants.id = memberships.tenant_id
     WHERE memberships.user_id = ? AND tenants.status = 'active'
     ORDER BY tenants.name`,
    userId,
  );
  return rows.map(({ role, ...tenant }) => ({ tenant, role: isRole(role) ? role : "viewer" }));
}

export async function getMembership(db: Db, userId: string, slug: string): Promise<Membership | null> {
  const row = await db.first<TenantRow & { role: string }>(
    `SELECT tenants.*, memberships.role FROM memberships
     JOIN tenants ON tenants.id = memberships.tenant_id
     WHERE memberships.user_id = ? AND tenants.slug = ? AND tenants.status = 'active'`,
    userId,
    slug,
  );
  if (!row) return null;
  const { role, ...tenant } = row;
  return { tenant, role: isRole(role) ? role : "viewer" };
}

export async function getTenantById(db: Db, id: string): Promise<TenantRow | null> {
  return db.first<TenantRow>("SELECT * FROM tenants WHERE id = ?", id);
}

export async function getTenantBySlug(db: Db, slug: string): Promise<TenantRow | null> {
  return db.first<TenantRow>("SELECT * FROM tenants WHERE slug = ?", slug);
}

export async function insertTenant(
  db: Db,
  input: { slug: string; name: string; locale: string; ownerId: string; allocation: DatabaseAllocation },
): Promise<TenantRow> {
  const error = validateSlug(input.slug);
  if (error) throw new AppError("validation", error, { slug: error });
  if (await getTenantBySlug(db, input.slug)) {
    throw new AppError("conflict", "This company address is already taken.", { slug: "Already taken" });
  }
  const id = uuid();
  await db.batch([
    {
      sql: `INSERT INTO tenants (id, slug, name, locale, db_strategy, db_binding, d1_database_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        input.slug,
        input.name,
        input.locale,
        input.allocation.db_strategy,
        input.allocation.db_binding,
        input.allocation.d1_database_id,
        input.ownerId,
      ],
    },
    { sql: "INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'owner')", params: [input.ownerId, id] },
  ]);
  return (await getTenantById(db, id))!;
}

export async function renameTenant(db: Db, tenantId: string, name: string) {
  await db.run("UPDATE tenants SET name = ?, updated_at = ? WHERE id = ?", name, nowIso(), tenantId);
}

export interface MemberRow {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  last_login_at: string | null;
  created_at: string;
}

export async function listMembers(db: Db, tenantId: string): Promise<MemberRow[]> {
  return db.all<MemberRow>(
    `SELECT users.id AS user_id, users.email, users.name, memberships.role, users.last_login_at, memberships.created_at
     FROM memberships JOIN users ON users.id = memberships.user_id
     WHERE memberships.tenant_id = ? ORDER BY users.name`,
    tenantId,
  );
}

export async function setMemberRole(db: Db, tenantId: string, userId: string, role: Role) {
  if (role !== "owner") {
    const owners = await db.value<number>(
      "SELECT COUNT(*) FROM memberships WHERE tenant_id = ? AND role = 'owner' AND user_id != ?",
      tenantId,
      userId,
    );
    const current = await db.value<string>(
      "SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?",
      tenantId,
      userId,
    );
    if (current === "owner" && !owners) throw new AppError("validation", "A company needs at least one owner.");
  }
  await db.run("UPDATE memberships SET role = ? WHERE tenant_id = ? AND user_id = ?", role, tenantId, userId);
}

export async function removeMember(db: Db, tenantId: string, userId: string) {
  const role = await db.value<string>(
    "SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?",
    tenantId,
    userId,
  );
  if (role === "owner") {
    const owners = await db.value<number>(
      "SELECT COUNT(*) FROM memberships WHERE tenant_id = ? AND role = 'owner'",
      tenantId,
    );
    if ((owners ?? 0) <= 1) throw new AppError("validation", "The last owner cannot be removed.");
  }
  await db.batch([
    { sql: "DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?", params: [tenantId, userId] },
    { sql: "UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL", params: [nowIso(), tenantId, userId] },
  ]);
}

/**
 * Adds an existing user directly, or creates an invitation token for a new one.
 * Returns the raw invitation token when one was created.
 */
export async function inviteMember(
  db: Db,
  input: { tenantId: string; email: string; role: Role; invitedBy: string },
): Promise<{ added: boolean; token?: string }> {
  const email = input.email.trim().toLowerCase();
  const existing = await findUserByEmail(db, email);
  if (existing) {
    await db.run(
      "INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role",
      existing.id,
      input.tenantId,
      input.role,
    );
    return { added: true };
  }
  const token = randomToken(24);
  await db.run(
    `INSERT INTO invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    uuid(),
    input.tenantId,
    email,
    input.role,
    await sha256Hex(token),
    input.invitedBy,
    new Date(Date.now() + 14 * 86_400_000).toISOString(),
  );
  return { added: false, token };
}

export async function acceptInvitation(db: Db, token: string, userId: string): Promise<TenantRow | null> {
  const inv = await db.first<{ id: string; tenant_id: string; role: string; expires_at: string; accepted_at: string | null }>(
    "SELECT * FROM invitations WHERE token_hash = ?",
    await sha256Hex(token),
  );
  if (!inv || inv.accepted_at || Date.parse(inv.expires_at) < Date.now()) return null;
  await db.batch([
    {
      sql: "INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      params: [userId, inv.tenant_id, inv.role],
    },
    { sql: "UPDATE invitations SET accepted_at = ? WHERE id = ?", params: [nowIso(), inv.id] },
  ]);
  return getTenantById(db, inv.tenant_id);
}

export async function listInvitations(db: Db, tenantId: string) {
  return db.all<{ id: string; email: string; role: string; expires_at: string; created_at: string }>(
    "SELECT id, email, role, expires_at, created_at FROM invitations WHERE tenant_id = ? AND accepted_at IS NULL ORDER BY created_at DESC",
    tenantId,
  );
}

// ---------------------------------------------------------------- API keys

export const API_KEY_PREFIX = "bz_";

export async function createApiKey(
  db: Db,
  input: { tenantId: string; userId: string; userRole: Role; name: string; scope: "read" | "write"; role?: Role; expiresAt?: string | null },
): Promise<{ key: string; record: ApiKeyRow }> {
  const secret = randomToken(30);
  const key = `${API_KEY_PREFIX}${secret}`;
  const id = uuid();
  const role = minRole(input.role ?? input.userRole, input.userRole);
  await db.run(
    `INSERT INTO api_keys (id, tenant_id, user_id, name, prefix, key_hash, scope, role, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.userId,
    input.name.trim() || "API key",
    key.slice(0, 10),
    await sha256Hex(key),
    input.scope,
    role,
    input.expiresAt ?? null,
  );
  const record = (await db.first<ApiKeyRow>("SELECT * FROM api_keys WHERE id = ?", id))!;
  return { key, record };
}

export async function listApiKeys(db: Db, tenantId: string) {
  return db.all<ApiKeyRow & { user_name: string }>(
    `SELECT api_keys.*, users.name AS user_name FROM api_keys
     JOIN users ON users.id = api_keys.user_id
     WHERE api_keys.tenant_id = ? ORDER BY api_keys.created_at DESC`,
    tenantId,
  );
}

export async function revokeApiKey(db: Db, tenantId: string, id: string) {
  await db.run("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ?", nowIso(), id, tenantId);
}

export interface VerifiedApiKey {
  key: ApiKeyRow;
  tenant: TenantRow;
  user: UserRow;
  role: Role;
}

export async function verifyApiKey(db: Db, raw: string): Promise<VerifiedApiKey | null> {
  if (!raw.startsWith(API_KEY_PREFIX)) return null;
  const key = await db.first<ApiKeyRow>("SELECT * FROM api_keys WHERE key_hash = ?", await sha256Hex(raw));
  if (!key || key.revoked_at) return null;
  if (key.expires_at && Date.parse(key.expires_at) < Date.now()) return null;
  const [tenant, user] = await Promise.all([getTenantById(db, key.tenant_id), getUser(db, key.user_id)]);
  if (!tenant || tenant.status !== "active" || !user) return null;
  const membership = await db.value<string>(
    "SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?",
    tenant.id,
    user.id,
  );
  if (!membership || !isRole(membership)) return null;
  // Never exceed the creator's current role.
  const role = minRole(isRole(key.role) ? key.role : "viewer", membership);
  if (!key.last_used_at || Date.now() - Date.parse(key.last_used_at) > 60_000) {
    await db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", nowIso(), key.id);
  }
  return { key, tenant, user, role };
}
