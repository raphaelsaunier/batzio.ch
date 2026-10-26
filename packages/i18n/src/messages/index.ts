import type { Locale, Messages } from "../index";
import { CATALOG } from "./catalog";

/** Builds the per-locale dictionaries from the catalog rows [en, de, fr, it]. */
const INDEX: Record<Exclude<Locale, "en">, number> = { de: 1, fr: 2, it: 3 };

export const MESSAGES: Record<Locale, Messages> = {
  en: {},
  ...(Object.fromEntries(
    (Object.keys(INDEX) as Exclude<Locale, "en">[]).map((l) => [l, Object.fromEntries(CATALOG.map((row) => [row[0], row[INDEX[l]]]))]),
  ) as Record<Exclude<Locale, "en">, Messages>),
};
