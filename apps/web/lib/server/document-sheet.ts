import type { SheetContext } from "@/components/document/document-sheet";
import type { ResourceDef, Row } from "@batzio/server/resources/types";
import { COMPANY_FIELDS } from "@batzio/server/admin";
import { canCtx, type Ctx } from "@batzio/server/ctx";
import { contactSnapshot, defaultTexts, DOCUMENT_KIND as KIND } from "@batzio/server/document-defaults";
import { loadContact } from "@batzio/server/sales";
import { translateField } from "@batzio/server/resources/client";
import { getResource } from "@batzio/server/resources/registry";
import { getSettings } from "@batzio/server/settings";
import { getT } from "@/lib/i18n/server";

/** What the bank panel edits of an account; the rest stays in the bank account form. */
const BANK_FIELDS = ["name", "bank_name", "iban", "qr_iban", "bic"];

export { contactSnapshot, newDocumentDefaults } from "@batzio/server/document-defaults";

/** Everything the A4 editor needs to draw a document exactly like the PDF. */
export async function documentSheetContext(ctx: Ctx, res: ResourceDef, record: Row | null, tenant: string): Promise<SheetContext> {
  const company = await getSettings(ctx, "company");
  const t = await getT();
  const banks = await ctx.db.all<SheetContext["banks"][number]>("SELECT id, name, bank_name, iban, qr_iban, bic FROM bank_accounts ORDER BY is_default DESC, id");
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
      document_footer: company.document_footer,
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
    canEditSettings: canCtx(ctx, "settings", "write"),
    canEditBanks: canCtx(ctx, "banking", "write"),
    forms: {
      company: COMPANY_FIELDS.map((f) => translateField(f, t)),
      bank: getResource("bank_accounts")!.fields.filter((f) => BANK_FIELDS.includes(f.name)).map((f) => translateField(f, t)),
    },
  };
}
