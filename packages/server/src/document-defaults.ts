import type { ResourceDef, Row } from "./resources/types";
import type { Ctx } from "./ctx";
import { formatAddressBlock, loadContact } from "./sales";
import { documentText, getSettings, type DocumentTexts } from "./settings";

/** What a document prints for a contact: the address block, customer number and language. */
export interface ContactSnapshot {
  address: string;
  nr: string | null;
  language: string | null;
  payment_term_id: number | null;
  /** Structured address for the QR-bill “payable by” block (needs postcode and town). */
  debtor: { name: string; street: string | null; houseNumber: string | null; postcode: string; town: string; country: string } | null;
}

export type DefaultTexts = Record<"de" | "fr" | "it" | "en", { header: string | null; footer: string | null }>;

export const DOCUMENT_KIND: Record<string, string> = { quotes: "quote", orders: "order", deliveries: "delivery", invoices: "invoice", credit_notes: "credit_note", purchase_orders: "purchase_order" };
const KIND = DOCUMENT_KIND;

/** What a document prints for a contact: address block, customer number, language and QR debtor. */
export async function contactSnapshot(ctx: Ctx, contactId: number | null | undefined, personId?: number | null): Promise<ContactSnapshot | null> {
  const contact = await loadContact(ctx, contactId);
  if (!contact) return null;
  const person = personId ? await loadContact(ctx, personId) : null;
  return {
    address: formatAddressBlock(contact, person),
    nr: contact.nr ?? null,
    language: contact.language ?? null,
    payment_term_id: contact.payment_term_id ?? null,
    debtor:
      contact.postcode && contact.city
        ? {
            name: contact.type === "person" ? `${contact.name_2 ?? ""} ${contact.name_1}`.trim() : contact.name_1,
            street: contact.street,
            houseNumber: contact.house_number,
            postcode: contact.postcode,
            town: contact.city,
            country: contact.country_code || "CH",
          }
        : null,
  };
}

/** Default intro/closing texts per language, so the sheet can show (and swap) them before saving. */
export async function defaultTexts(ctx: Ctx, kind: string) {
  const texts = await getSettings(ctx, "texts");
  const pick = (lang: string, part: "header" | "footer") => {
    const key = `${kind}_${part}` as keyof DocumentTexts;
    return key in texts ? documentText(texts, lang, key) : null;
  };
  return Object.fromEntries(["de", "fr", "it", "en"].map((l) => [l, { header: pick(l, "header"), footer: pick(l, "footer") }])) as DefaultTexts;
}

/** Values a new document starts with (mirrors the server-side defaults). */
export async function newDocumentDefaults(ctx: Ctx, res: ResourceDef, contact: ContactSnapshot | null): Promise<Row> {
  const [company, accounting] = await Promise.all([getSettings(ctx, "company"), getSettings(ctx, "accounting")]);
  const kind = KIND[res.name] ?? "invoice";
  const language = contact?.language || company.language;
  const defaults = kind === "purchase_order" ? null : (await defaultTexts(ctx, kind))[language as "de"];
  return {
    language,
    currency_code: accounting.base_currency,
    vat_mode: accounting.vat_registered ? "excl" : "none",
    header: defaults?.header ?? null,
    footer: defaults?.footer ?? null,
    address: contact?.address ?? null,
    bank_account_id: kind === "invoice" || kind === "quote" ? await ctx.db.value<number>("SELECT id FROM bank_accounts ORDER BY is_default DESC, id LIMIT 1") : null,
  };
}
