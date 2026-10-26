import { formatIban } from "@batzio/core/swiss/iban";

/**
 * The company's lines on every letter (sender line, letterhead, page footer),
 * shared by the PDF renderer and the on-screen A4 editor so both print the same.
 */

export interface LetterheadCompany {
  name: string;
  legal_form: string;
  street: string;
  house_number: string;
  postcode: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  vat_number: string;
  document_footer?: string;
}

/** Lines a company's own page footer may have. */
export const FOOTER_LINES = 2;

/** “Muster GmbH · Bahnhofstrasse 1 · 8000 Zürich”, above the address window. */
export function companyLine(c: LetterheadCompany): string {
  return [c.name + (c.legal_form && !c.name.endsWith(c.legal_form) ? ` ${c.legal_form}` : ""), [c.street, c.house_number].filter(Boolean).join(" "), [c.postcode, c.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
}

/** Address and ways to reach the company, top right of the letterhead. */
export function contactLines(c: LetterheadCompany): string[] {
  return [[c.street, c.house_number].filter(Boolean).join(" "), [c.postcode, c.city].filter(Boolean).join(" "), c.phone, c.email, c.website].filter(Boolean);
}

/** The footer printed when the company has not written its own: company, UID and IBAN. */
export function automaticFooter(c: LetterheadCompany, iban: string | null): string {
  return [companyLine(c), c.vat_number ? `UID ${c.vat_number}` : null, iban ? `IBAN ${formatIban(iban)}` : null].filter(Boolean).join("   |   ");
}

/** The page footer: the company's own (two lines at most) or the automatic one. */
export function pageFooter(c: LetterheadCompany, iban: string | null): string[] {
  const own = (c.document_footer ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, FOOTER_LINES);
  return own.length ? own : [automaticFooter(c, iban)];
}
