import { getMembership, getSessionUser, verifyApiKey } from "@/lib/server/control";
import type { Ctx, Source } from "@/lib/server/ctx";
import { openControlDb, openTenantDb } from "@/lib/server/db/connections";
import type { R2LikeBucket } from "@/lib/server/db/types";
import { getEnv } from "@/lib/server/env";
import { AppError } from "@/lib/server/errors";
import { SESSION_COOKIE } from "@/lib/server/session-cookie";

export function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * Authenticates an API request.
 * - `Authorization: Bearer bz_…` API keys are bound to one company.
 * - Browser sessions (cookie) select the company via `?tenant=` or `X-Tenant`.
 */
export async function apiContext(request: Request, source: Source = "api"): Promise<Ctx> {
  const env = getEnv();
  const control = await openControlDb(env);
  const meta = {
    ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  };
  const files = env.FILES as R2LikeBucket | undefined;

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const verified = await verifyApiKey(control, auth.slice(7).trim());
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

  const token = cookie(request, SESSION_COOKIE);
  const user = token ? await getSessionUser(control, token) : null;
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
    actor: { type: "user", id: user.id, name: user.name, source: source === "api" ? "ui" : source, ...meta },
    db,
    control,
    files,
  };
}
