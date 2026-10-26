import { isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "@batzio/i18n";
import { cookie } from "./context";

/** Explicit choice (`?locale=` / body), then the language cookie, then Accept-Language. */
export function requestLocale(request: Request, explicit?: unknown): Locale {
  if (isLocale(explicit)) return explicit;
  const fromQuery = new URL(request.url).searchParams.get("locale");
  if (isLocale(fromQuery)) return fromQuery;
  const c = cookie(request, LOCALE_COOKIE);
  if (isLocale(c)) return c;
  return negotiateLocale(request.headers.get("accept-language")) ?? "en";
}
