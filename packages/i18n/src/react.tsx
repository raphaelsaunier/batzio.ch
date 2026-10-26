"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createT, DEFAULT_LOCALE, type Locale, type Messages, type Msg, type TFunction } from "./index";

const I18nContext = createContext<{ locale: Locale; t: TFunction }>({ locale: DEFAULT_LOCALE, t: createT(null) });

// The catalog is sent once with the first document and kept here, so client-side
// navigations don't carry it again in every RSC payload.
let loaded: { locale: Locale; version: string; messages: Messages } | null = null;

/**
 * Provides translations. `messages` comes with full page loads; navigations omit
 * it and reuse the catalog already in memory (fetching `/i18n/<locale>` if the
 * language or catalog version changed in between).
 */
export function I18nProvider({ locale, version, messages, children }: { locale: Locale; version: string; messages?: Messages; children: React.ReactNode }) {
  // Only the browser keeps a module-level copy; server renders always receive messages.
  if (messages && typeof window !== "undefined" && loaded?.messages !== messages) loaded = { locale, version, messages };
  const current = messages ?? (loaded && loaded.locale === locale && loaded.version === version ? loaded.messages : null);
  const [fetched, setFetched] = useState<Messages | null>(null);
  useEffect(() => {
    if (current) return;
    let cancelled = false;
    fetch(`/i18n/${locale}?v=${version}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Messages | null) => {
        if (cancelled || !m) return;
        loaded = { locale, version, messages: m };
        setFetched(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current, locale, version]);
  const active = current ?? fetched ?? loaded?.messages ?? {};
  const value = useMemo(() => ({ locale, t: createT(active) }), [locale, active]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useT = () => useContext(I18nContext).t;
export const useLocale = () => useContext(I18nContext).locale;
/** Renders a Msg; string variables (e.g. category names) are translated as well. */
export const useMsg = () => {
  const t = useT();
  return (m: Msg) => t(m[0], m[1] && Object.fromEntries(Object.entries(m[1]).map(([k, v]) => [k, typeof v === "string" ? t(v) : v])));
};
