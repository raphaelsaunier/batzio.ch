import { cookies, headers } from "next/headers";
import { cache } from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "@batzio/i18n";
import { tFor } from "@batzio/i18n/server";

export { messagesFor, tFor } from "@batzio/i18n/server";

/** Cookie first (set by the language switcher / at login), then the browser's languages. */
export const getLocale = cache(async (): Promise<Locale> => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(value)) return value;
  return negotiateLocale((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
});

export const getT = cache(async () => tFor(await getLocale()));

export async function setLocaleCookie(locale: Locale) {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
