/**
 * Gettext-style translations: English source strings are the keys, so code
 * stays readable and a missing translation falls back to English. Variables
 * use `{name}` placeholders.
 */
export type Locale = "en" | "de" | "fr" | "it";
export const LOCALES: Locale[] = ["en", "de", "fr", "it"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "batzio_locale";
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch", fr: "Français", it: "Italiano" };

export type Messages = Record<string, string>;
export type Vars = Record<string, string | number | null | undefined>;
export type TFunction = (key: string, vars?: Vars) => string;

/** A message to translate later: English template plus variables. */
export type Msg = [string, Vars?];

/** gettext-style marker for constant strings that are translated later with t(variable). */
export const N_ = <T extends string>(s: T): T => s;

/** Marks a string for translation without translating it (picked up by the coverage test). */
export const msg = (template: string, vars?: Vars): Msg => (vars ? [template, vars] : [template]);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as string[]).includes(value);
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? all : String(v);
  });
}

export function createT(messages: Messages | null | undefined): TFunction {
  return (key, vars) => interpolate((messages && messages[key]) || key, vars);
}

export const renderMsg = (t: TFunction, m: Msg) => t(m[0], m[1]);

/** First supported language from an Accept-Language header. */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().slice(0, 2), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  return ranked.find((r) => isLocale(r.lang))?.lang as Locale | undefined ?? null;
}

/** Swiss regional variant for Intl APIs. */
export const intlLocale = (locale: Locale) => `${locale}-CH`;

/** Document language (as stored on contacts/settings) → UI locale. */
export const localeFromLanguage = (language: string | null | undefined): Locale =>
  isLocale(language?.slice(0, 2)) ? (language!.slice(0, 2) as Locale) : DEFAULT_LOCALE;

export function monthName(month: number, locale: Locale, style: "long" | "short" = "short"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2000, month - 1, 15)));
}

/** Relative day phrasing: "today", "in 3 days", "5 days ago". */
export function relativeDays(days: number, t: TFunction): string {
  if (days === 0) return t("today");
  if (days === 1) return t("tomorrow");
  if (days === -1) return t("yesterday");
  return days > 0 ? t("in {n} days", { n: days }) : t("{n} days ago", { n: -days });
}
