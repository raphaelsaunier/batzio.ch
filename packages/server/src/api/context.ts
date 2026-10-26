import { API_KEY_PREFIX, getMembership, getSessionUser, verifyApiKey, type UserRow } from "../control";
import type { Ctx, Source } from "../ctx";
import { openControlDb, openTenantDb } from "../db/connections";
import type { R2LikeBucket } from "../db/types";
import { getEnv } from "../env";
import { AppError } from "../errors";
import { SESSION_COOKIE } from "../session-cookie";

export function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function bearer(request: Request): string | null {
  const auth = request.headers.get("authorization");
  return auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
}

/** The signed-in person behind a browser cookie or an app's session token (no company yet). */
export async function userContext(request: Request): Promise<{ user: UserRow; token: string; control: Ctx["control"] }> {
  const control = await openControlDb(getEnv());
  const token = bearer(request) ?? cookie(request, SESSION_COOKIE);
  if (!token || token.startsWith(API_KEY_PREFIX)) throw new AppError("unauthorized", "Sign in first.");
  const user = await getSessionUser(control, token);
  if (!user) throw new AppError("unauthorized", "Your session has expired. Please sign in again.");
  return { user, token, control };
}

/**
 * Authenticates an API request.
 * - `Authorization: Bearer bz_…` API keys are bound to one company.
 * - Browser sessions (cookie) and the native apps' session tokens
 *   (`Authorization: Bearer <session>`) select the company via `?tenant=` or `X-Tenant`.
 */
export async function apiContext(request: Request, source: Source = "api"): Promise<Ctx> {
  const env = getEnv();
  const control = await openControlDb(env);
  const meta = {
    ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  };
  const files = env.FILES as R2LikeBucket | undefined;

  const token = bearer(request);
  if (token?.startsWith(API_KEY_PREFIX)) {
    const verified = await verifyApiKey(control, token);
    if (!verified) throw new AppError("unauthorized", "Invalid, expired or revoked API key.");
    const db = await openTenantDb(env, verified.tenant);
    return {
      tenant: { id: verified.tenant.id, slug: verified.tenant.slug, name: verified.tenant.name, locale: verified.tenant.locale },
      user: { id: verified.user.id, name: verified.user.name, email: verified.user.email },
      role: verified.role,
      scope: verified.key.scope === "read" ? "read" : "write",
      actor: { type: "api_key", id: verified.key.id, name: `${verified.user.name} (${verified.key.name})`, source, ...meta },
      db,
      control,
      files,
    };
  }

  const session = token ?? cookie(request, SESSION_COOKIE);
  const user = session ? await getSessionUser(control, session) : null;
  if (!user) throw new AppError("unauthorized", "Authentication required. Send an API key as Bearer token.");
  const slug = new URL(request.url).searchParams.get("tenant") ?? request.headers.get("x-tenant");
  if (!slug) throw new AppError("validation", "Select a company with ?tenant=<slug> or the X-Tenant header.");
  const membership = await getMembership(control, user.id, slug);
  if (!membership) throw new AppError("forbidden", "You are not a member of this company.");
  const db = await openTenantDb(env, membership.tenant);
  return {
    tenant: { id: membership.tenant.id, slug: membership.tenant.slug, name: membership.tenant.name, locale: membership.tenant.locale },
    user: { id: user.id, name: user.name, email: user.email },
    role: membership.role,
    scope: "write",
    actor: { type: "user", id: user.id, name: user.name, source: source === "api" ? (token ? "app" : "ui") : source, ...meta },
    db,
    control,
    files,
  };
}
