"use server";

import { redirect } from "next/navigation";
import {
  acceptInvitation,
  authenticate,
  createSession,
  createUser,
  deleteSession,
  listMemberships,
  slugify,
} from "@/lib/server/control";
import { getEnv } from "@/lib/server/env";
import { AppError, errorText, toAppError } from "@/lib/server/errors";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { getLocale, getT, setLocaleCookie } from "@/lib/i18n/server";
import { clearSessionCookie, getControl, requestMeta, requireUser, SESSION_COOKIE, setSessionCookie } from "@/lib/server/session";
import { createCompany } from "@/lib/server/tenants";
import type { Lang } from "@/lib/swiss/chart-of-accounts";
import { cookies } from "next/headers";

export interface FormState {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const LANGS: Lang[] = ["de", "fr", "it", "en"];

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  const next = str(form, "next");
  let target = "/select";
  try {
    const control = await getControl();
    const meta = await requestMeta();
    const user = await authenticate(control, email, password, meta.ip ?? "unknown");
    const session = await createSession(control, user.id, { ip: meta.ip ?? undefined, userAgent: meta.userAgent ?? undefined });
    await setSessionCookie(session.token, session.expires);
    if (!(await cookies()).get(LOCALE_COOKIE) && isLocale(user.locale)) await setLocaleCookie(user.locale);
    const invite = str(form, "invite");
    if (invite) {
      const tenant = await acceptInvitation(control, invite, user.id);
      if (tenant) target = `/${tenant.slug}`;
    }
    if (target === "/select") {
      const memberships = await listMemberships(control, user.id);
      if (memberships.length === 1) target = `/${memberships[0].tenant.slug}`;
    }
    if (next.startsWith("/") && !next.startsWith("//")) target = next;
  } catch (error) {
    const e = toAppError(error);
    return { error: errorText(e, await getT()), values: { email } };
  }
  redirect(target);
}

export async function signupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = {
    name: str(form, "name"),
    email: str(form, "email"),
    company: str(form, "company"),
    slug: str(form, "slug"),
    language: str(form, "language") || "de",
  };
  const password = String(form.get("password") ?? "");
  let target = "/select";
  try {
    if (!values.name) throw new AppError("validation", "Please enter your name.", { name: "Required" });
    if (!values.company) throw new AppError("validation", "Please enter your company name.", { company: "Required" });
    const control = await getControl();
    const user = await createUser(control, { email: values.email, name: values.name, password, locale: await getLocale() });
    const meta = await requestMeta();
    const session = await createSession(control, user.id, { ip: meta.ip ?? undefined, userAgent: meta.userAgent ?? undefined });
    await setSessionCookie(session.token, session.expires);
    const invite = str(form, "invite");
    if (invite) {
      const tenant = await acceptInvitation(control, invite, user.id);
      if (tenant) target = `/${tenant.slug}`;
    }
    if (target === "/select") {
      const tenant = await createCompany(getEnv(), control, user, {
        name: values.company,
        slug: values.slug || slugify(values.company),
        language: (LANGS.includes(values.language as Lang) ? values.language : "de") as Lang,
        demo: form.get("demo") === "on",
      });
      target = `/${tenant.slug}`;
    }
  } catch (error) {
    const e = toAppError(error);
    return { error: errorText(e, await getT()), fields: e.fields, values };
  }
  redirect(target);
}

export async function createCompanyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = { company: str(form, "company"), slug: str(form, "slug"), language: str(form, "language") || "de" };
  let target: string;
  try {
    const user = await requireUser();
    if (!values.company) throw new AppError("validation", "Please enter a company name.", { company: "Required" });
    const tenant = await createCompany(getEnv(), await getControl(), user, {
      name: values.company,
      slug: values.slug || slugify(values.company),
      language: (LANGS.includes(values.language as Lang) ? values.language : "de") as Lang,
      demo: form.get("demo") === "on",
    });
    target = `/${tenant.slug}`;
  } catch (error) {
    const e = toAppError(error);
    return { error: errorText(e, await getT()), fields: e.fields, values };
  }
  redirect(target);
}

export async function logoutAction(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await getControl(), token);
  await clearSessionCookie();
  redirect("/login");
}
