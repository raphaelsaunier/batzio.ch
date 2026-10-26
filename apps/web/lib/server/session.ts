import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getMembership, getSessionUser, SESSION_TTL_DAYS, type Membership, type UserRow } from "@batzio/server/control";
import type { Ctx, Source } from "@batzio/server/ctx";
import { openControlDb, openTenantDb } from "@batzio/server/db/connections";
import type { Db } from "@batzio/server/db/db";
import type { R2LikeBucket } from "@batzio/server/db/types";
import { getEnv } from "@batzio/server/env";
import { SESSION_COOKIE } from "@batzio/server/session-cookie";

export { SESSION_COOKIE };

export const getControl = cache(async (): Promise<Db> => openControlDb(getEnv()));

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null; secure: boolean }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (h.get("host")?.startsWith("localhost") ? "http" : "https");
  return {
    ip: h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
    secure: proto === "https",
  };
}

export const currentUser = cache(async (): Promise<UserRow | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(await getControl(), token);
});

export async function requireUser(): Promise<UserRow> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSessionCookie(token: string, expires: string) {
  const { secure } = await requestMeta();
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: new Date(expires),
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const getMembershipFor = cache(async (slug: string): Promise<{ user: UserRow; membership: Membership }> => {
  const user = await requireUser();
  const membership = await getMembership(await getControl(), user.id, slug);
  if (!membership) notFound();
  return { user, membership };
});

/** Builds the domain context for a server component or server action. */
export const tenantCtx = cache(async (slug: string, source: Source = "ui"): Promise<Ctx> => {
  const { user, membership } = await getMembershipFor(slug);
  const env = getEnv();
  const [db, control, meta] = await Promise.all([openTenantDb(env, membership.tenant), getControl(), requestMeta()]);
  return {
    tenant: {
      id: membership.tenant.id,
      slug: membership.tenant.slug,
      name: membership.tenant.name,
      locale: membership.tenant.locale,
    },
    user: { id: user.id, name: user.name, email: user.email },
    role: membership.role,
    scope: "write",
    actor: { type: "user", id: user.id, name: user.name, source, ip: meta.ip, userAgent: meta.userAgent },
    db,
    control,
    files: env.FILES as R2LikeBucket | undefined,
  };
});
