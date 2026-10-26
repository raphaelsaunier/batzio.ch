import { createT, type Locale, type Messages } from "./index";
import { MESSAGES } from "./messages";

/** Full catalogs; server-side only (clients receive just their locale's messages). */
export const messagesFor = (locale: Locale): Messages => MESSAGES[locale] ?? {};
export const tFor = (locale: Locale) => createT(messagesFor(locale));

/** Changes whenever any translation changes; lets browsers cache a catalog forever. */
export const CATALOG_VERSION = (() => {
  const text = JSON.stringify(MESSAGES);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
})();
