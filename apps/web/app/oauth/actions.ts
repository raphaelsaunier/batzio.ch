"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { approveOauth, denyOauth, publicOrigin } from "@batzio/server/oauth";
import { errorText, toAppError } from "@batzio/server/errors";
import { getT } from "@/lib/i18n/server";
import { currentUser, getControl } from "@/lib/server/session";

async function origin() {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return publicOrigin(new Request(`${proto}://${host}/`));
}

function authorizeUrl(base: string, form: FormData) {
  const url = new URL("/oauth/authorize", base);
  url.searchParams.set("response_type", "code");
  for (const key of ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource", "scope"]) {
    const value = form.get(key);
    if (typeof value === "string" && value) url.searchParams.set(key, value);
  }
  return url;
}

function str(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function isRedirect(error: unknown) {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT");
}

export async function approveOauthAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const user = await currentUser();
  if (!user) redirect("/login");
  try {
    const target = await approveOauth(await getControl(), {
      userId: user.id,
      origin: await origin(),
      clientId: str(form, "client_id"),
      redirectUri: str(form, "redirect_uri"),
      codeChallenge: str(form, "code_challenge"),
      codeChallengeMethod: str(form, "code_challenge_method"),
      state: str(form, "state") || null,
      resource: str(form, "resource") || null,
      tenantSlug: str(form, "tenant"),
      scope: str(form, "scope"),
      role: str(form, "role"),
    });
    redirect(target);
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: errorText(toAppError(error), await getT()) };
  }
}

export async function denyOauthAction(form: FormData): Promise<void> {
  const target = await denyOauth(await getControl(), authorizeUrl(await origin(), form));
  redirect(target ?? "/");
}
