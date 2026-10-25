"use client";

import { createContext, useContext, useMemo } from "react";
import { createT, DEFAULT_LOCALE, type Locale, type Messages, type Msg, type TFunction } from "./index";

const I18nContext = createContext<{ locale: Locale; t: TFunction }>({ locale: DEFAULT_LOCALE, t: createT(null) });

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: createT(messages) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useT = () => useContext(I18nContext).t;
export const useLocale = () => useContext(I18nContext).locale;
/** Renders a Msg; string variables (e.g. category names) are translated as well. */
export const useMsg = () => {
  const t = useT();
  return (m: Msg) => t(m[0], m[1] && Object.fromEntries(Object.entries(m[1]).map(([k, v]) => [k, typeof v === "string" ? t(v) : v])));
};
