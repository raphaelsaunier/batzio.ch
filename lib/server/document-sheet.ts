import type { ContactSnapshot } from "@/app/(app)/[tenant]/actions";
import type { SheetContext } from "@/components/document/document-sheet";
import type { ResourceDef, Row } from "@/lib/resources/types";
import type { Ctx } from "./ctx";
import { formatAddressBlock, loadContact } from "./sales";
import { documentText, getSettings, type DocumentTexts } from "./settings";

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
async function defaultTexts(ctx: Ctx, kind: string) {
  const texts = await getSettings(ctx, "texts");
  const pick = (lang: string, part: "header" | "footer") => {
    const key = `${kind}_${part}` as keyof DocumentTexts;
    return key in texts ? documentText(texts, lang, key) : null;
  };
  return Object.fromEntries(["de", "fr", "it", "en"].map((l) => [l, { header: pick(l, "header"), footer: pick(l, "footer") }])) as SheetContext["defaults"];
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

const KIND: Record<string, string> = { quotes: "quote", orders: "order", deliveries: "delivery", invoices: "invoice", credit_notes: "credit_note", purchase_orders: "purchase_order" };

/** Everything the A4 editor needs to draw a document exactly like the PDF. */
export async function documentSheetContext(ctx: Ctx, res: ResourceDef, record: Row | null, tenant: string): Promise<SheetContext> {
  const company = await getSettings(ctx, "company");
  const banks = await ctx.db.all<{ id: number; iban: string | null; qr_iban: string | null }>("SELECT id, iban, qr_iban FROM bank_accounts ORDER BY is_default DESC, id");
  const contactId = record?.contact_id ? Number(record.contact_id) : null;
  const personId = record?.contact_person_id ? Number(record.contact_person_id) : null;
  const person = personId ? await loadContact(ctx, personId) : null;
  return {
    kind: KIND[res.name] ?? "invoice",
    company: {
      name: company.name,
      legal_form: company.legal_form,
      street: company.street,
      house_number: company.house_number,
      postcode: company.postcode,
      city: company.city,
      country_code: company.country_code,
      phone: company.phone,
      email: company.email,
      website: company.website,
      vat_number: company.vat_number,
      accent_color: company.accent_color,
      language: company.language,
    },
    logoUrl: company.logo_file_id ? `/api/v1/files/${company.logo_file_id}/download?tenant=${tenant}&inline=1` : null,
    banks,
    contact: await contactSnapshot(ctx, contactId, personId),
    person: person ? `${person.name_2 ?? ""} ${person.name_1}`.trim() : null,
    nr: (record?.nr as string | null) ?? null,
    status: String(record?.status ?? "draft"),
    amountPaid: Number(record?.amount_paid ?? 0),
    amountOpen: Number(record?.amount_open ?? 0),
    qrReference: (record?.qr_reference as string | null) ?? null,
    pdfHref: record?.id ? `/api/v1/${res.name}/${record.id}/pdf?tenant=${tenant}` : undefined,
    defaults: await defaultTexts(ctx, KIND[res.name] ?? "invoice"),
  };
}
