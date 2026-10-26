import { calculateDocument, type VatMode } from "@batzio/core/calc/documents";
import { addDays, addMonths, today } from "@batzio/core/format";
import { toCents } from "@batzio/core/money";
import { getResource } from "./resources/registry";
import type { Row } from "./resources/types";
import { SYSTEM_ACCOUNTS } from "@batzio/core/swiss/chart-of-accounts";
import { createQrReference } from "@batzio/core/swiss/references";
import { accountIdByNumber, postEntry, reverseEntry, type EntryLineInput } from "./accounting";
import { audit } from "./audit";
import { createRecord, getRecord, patchColumns } from "./crud";
import type { Ctx } from "./ctx";
import { placeholders } from "./db/db";
import { AppError } from "./errors";
import { t } from "./pdf/i18n";
import { documentText, getSettings, type DocumentTexts } from "./settings";

export type DocKind = "quote" | "order" | "delivery" | "invoice" | "credit_note" | "purchase_order";

export const KIND_RESOURCE: Record<DocKind, string> = {
  quote: "quotes",
  order: "orders",
  delivery: "deliveries",
  invoice: "invoices",
  credit_note: "credit_notes",
  purchase_order: "purchase_orders",
};

export const KIND_LABEL: Record<DocKind, string> = {
  quote: "Quote",
  order: "Sales order",
  delivery: "Delivery note",
  invoice: "Invoice",
  credit_note: "Credit note",
  purchase_order: "Purchase order",
};

export interface ContactRow {
  id: number;
  nr: string | null;
  type: "company" | "person";
  name_1: string;
  name_2: string | null;
  salutation_id: number | null;
  title_id: number | null;
  street: string | null;
  house_number: string | null;
  address_addition: string | null;
  postcode: string | null;
  city: string | null;
  country_code: string;
  email: string | null;
  language: string;
  vat_number: string | null;
  iban: string | null;
  payment_term_id: number | null;
  currency_code: string | null;
  discount_percent: number | null;
}

export interface PositionRow {
  id?: number;
  document_id?: number;
  sort?: number;
  type: string;
  item_id: number | null;
  code: string | null;
  text: string | null;
  quantity: number;
  unit_name: string | null;
  unit_price: number;
  discount_percent: number;
  tax_id: number | null;
  tax_rate: number;
  account_id: number | null;
  is_optional: number;
  total: number;
}

export interface DocumentRow {
  id: number;
  kind: DocKind;
  nr: string | null;
  title: string | null;
  status: string;
  contact_id: number | null;
  contact_person_id: number | null;
  address: string | null;
  delivery_address: string | null;
  project_id: number | null;
  language: string;
  currency_code: string;
  exchange_rate: number;
  vat_mode: VatMode;
  date: string;
  due_date: string | null;
  payment_term_id: number | null;
  bank_account_id: number | null;
  reference: string | null;
  header: string | null;
  footer: string | null;
  total_net: number;
  total_vat: number;
  rounding: number;
  total: number;
  amount_paid: number;
  amount_open: number;
  qr_reference: string | null;
  source_id: number | null;
  repetition: string | null;
  next_run_date: string | null;
  reminder_level: number;
  journal_entry_id: number | null;
  sent_at: string | null;
  positions: PositionRow[];
}

const docResource = (kind: DocKind) => getResource(KIND_RESOURCE[kind])!;

export const isSalesKind = (kind: string) => kind !== "purchase_order";

// ------------------------------------------------------------ addresses

export function formatAddressBlock(contact: ContactRow, person?: ContactRow | null): string {
  const lines: string[] = [];
  if (contact.type === "company") {
    lines.push(contact.name_1);
    if (contact.name_2) lines.push(contact.name_2);
    if (person) lines.push(`${person.name_2 ?? ""} ${person.name_1}`.trim());
  } else {
    lines.push(`${contact.name_2 ?? ""} ${contact.name_1}`.trim());
  }
  if (contact.address_addition) lines.push(contact.address_addition);
  const street = [contact.street, contact.house_number].filter(Boolean).join(" ");
  if (street) lines.push(street);
  const city = [contact.postcode, contact.city].filter(Boolean).join(" ");
  if (city) lines.push(contact.country_code && contact.country_code !== "CH" ? `${contact.country_code}-${city}` : city);
  return lines.join("\n");
}

export async function loadContact(ctx: Ctx, id: number | null | undefined): Promise<ContactRow | null> {
  if (!id) return null;
  return ctx.db.first<ContactRow>("SELECT * FROM contacts WHERE id = ?", id);
}

// ------------------------------------------------------------ preparation

async function defaultTaxId(ctx: Ctx, kind: DocKind): Promise<number | null> {
  const code = isSalesKind(kind) ? "UN81" : "VM81";
  return ctx.db.value<number>("SELECT id FROM taxes WHERE code = ? AND is_active = 1", code);
}

export async function roundingStep(ctx: Ctx, currency: string): Promise<number> {
  if (currency === "CHF") return (await getSettings(ctx, "accounting")).chf_rounding;
  return (await ctx.db.value<number>("SELECT rounding FROM currencies WHERE code = ?", currency)) ?? 0.01;
}

/** Fills item defaults and tax-rate snapshots on positions. */
async function enrichPositions(ctx: Ctx, kind: DocKind, positions: Row[], vatMode: VatMode): Promise<PositionRow[]> {
  const itemIds = [...new Set(positions.map((p) => p.item_id).filter(Boolean) as number[])];
  const items = itemIds.length
    ? await ctx.db.all<Row>(
        `SELECT items.*, units.name AS unit_label FROM items LEFT JOIN units ON units.id = items.unit_id WHERE items.id IN (${placeholders(itemIds.length)})`,
        ...itemIds,
      )
    : [];
  const itemMap = new Map(items.map((i) => [i.id as number, i]));
  const taxes = new Map(
    (await ctx.db.all<{ id: number; rate: number }>("SELECT id, rate FROM taxes")).map((t) => [t.id, t.rate]),
  );
  const fallbackTax = vatMode === "none" ? null : await defaultTaxId(ctx, kind);
  const sales = isSalesKind(kind);

  return positions.map((raw, index) => {
    const p = { ...raw } as Row;
    const type = String(p.type ?? (p.item_id ? "item" : "custom"));
    p.type = type;
    p.sort = index;
    const priced = type === "item" || type === "custom";
    const item = p.item_id ? itemMap.get(Number(p.item_id)) : undefined;
    if (item) {
      p.code ??= (item.nr as string) ?? null;
      p.text ??= [item.name, item.description].filter(Boolean).join("\n");
      p.unit_name ??= (item.unit_label as string) ?? null;
      if (p.unit_price === null || p.unit_price === undefined) {
        p.unit_price = Number((sales ? item.sale_price : item.purchase_price) ?? 0);
      }
      p.tax_id ??= (sales ? item.sales_tax_id : item.purchase_tax_id) ?? null;
      p.account_id ??= (sales ? item.revenue_account_id : item.expense_account_id) ?? null;
    }
    if (priced && vatMode !== "none" && !p.tax_id) p.tax_id = fallbackTax;
    if (vatMode === "none") p.tax_id = null;
    p.tax_rate = p.tax_id ? (taxes.get(Number(p.tax_id)) ?? 0) : 0;
    p.quantity = priced ? Number(p.quantity ?? 1) : Number(p.quantity ?? 0);
    p.unit_price = Number(p.unit_price ?? 0);
    p.discount_percent = Number(p.discount_percent ?? 0);
    p.is_optional = p.is_optional ? 1 : 0;
    return p as unknown as PositionRow;
  });
}

/** `prepare` hook shared by all document resources. */
export async function prepareDocument(ctx: Ctx, kind: DocKind, data: Row, existing: Row | null): Promise<Row> {
  const out: Row = { ...data };
  const merged = { ...(existing ?? {}), ...data } as unknown as DocumentRow;
  const accounting = await getSettings(ctx, "accounting");

  const contactChanged = data.contact_id !== undefined && data.contact_id !== existing?.contact_id;
  const personChanged = data.contact_person_id !== undefined && data.contact_person_id !== existing?.contact_person_id;
  if ((contactChanged || personChanged || !existing) && merged.contact_id) {
    const [contact, person] = await Promise.all([
      loadContact(ctx, merged.contact_id),
      loadContact(ctx, merged.contact_person_id),
    ]);
    if (!contact) throw new AppError("validation", "Contact not found.", { contact_id: "Unknown contact" });
    if (data.address === undefined || data.address === null || contactChanged) {
      if (!(typeof data.address === "string" && data.address.trim())) out.address = formatAddressBlock(contact, person);
    }
    if (!existing) {
      out.language ??= contact.language || (await getSettings(ctx, "company")).language;
      out.currency_code ??= contact.currency_code || accounting.base_currency;
      out.payment_term_id ??= contact.payment_term_id;
    }
  }
  if (!existing) {
    out.language ??= (await getSettings(ctx, "company")).language;
    out.currency_code ??= accounting.base_currency;
    out.vat_mode ??= accounting.vat_registered ? "excl" : "none";
    out.date ??= today();
    if (kind !== "purchase_order" && (!out.header || !out.footer)) {
      const texts = await getSettings(ctx, "texts");
      const lang = String(out.language);
      const headerKey = `${kind}_header` as keyof DocumentTexts;
      const footerKey = `${kind}_footer` as keyof DocumentTexts;
      if (headerKey in texts) out.header ??= documentText(texts, lang, headerKey);
      if (footerKey in texts) out.footer ??= documentText(texts, lang, footerKey);
    }
    if (kind === "invoice" || kind === "quote") {
      out.bank_account_id ??= await ctx.db.value<number>("SELECT id FROM bank_accounts ORDER BY is_default DESC, id LIMIT 1");
    }
  }

  // Due date / validity.
  const dateChanged = data.date !== undefined || data.payment_term_id !== undefined || !existing;
  if (dateChanged && (data.due_date === undefined || data.due_date === null)) {
    const date = String(out.date ?? merged.date ?? today());
    if (kind === "invoice" || kind === "credit_note") {
      const termId = (out.payment_term_id ?? merged.payment_term_id) as number | null;
      const days = termId
        ? ((await ctx.db.value<number>("SELECT days FROM payment_terms WHERE id = ?", termId)) ?? accounting.default_payment_days)
        : accounting.default_payment_days;
      out.due_date = addDays(date, days);
    } else if (kind === "quote") {
      out.due_date = addDays(date, accounting.quote_validity_days);
    }
  }

  const vatMode = (out.vat_mode ?? merged.vat_mode ?? "excl") as VatMode;
  const currency = String(out.currency_code ?? merged.currency_code ?? "CHF");
  const needsTotals = !existing || data.positions !== undefined || data.vat_mode !== undefined || data.currency_code !== undefined;
  if (needsTotals) {
    const source = (data.positions as Row[] | undefined) ?? ((existing?.positions as Row[] | undefined) ?? []);
    const positions = data.positions !== undefined ? await enrichPositions(ctx, kind, source, vatMode) : (source as unknown as PositionRow[]);
    const calc = calculateDocument(positions, vatMode, await roundingStep(ctx, currency));
    if (data.positions !== undefined) {
      positions.forEach((p, i) => (p.total = calc.lines[i]?.total ?? 0));
      out.positions = positions;
    }
    out.total_net = calc.totalNet;
    out.total_vat = calc.totalVat;
    out.rounding = calc.rounding;
    out.total = calc.total;
    out.amount_open = calc.total - Number(existing?.amount_paid ?? 0);
  }
  if (out.repetition !== undefined && out.repetition !== null && typeof out.repetition !== "string") {
    out.repetition = JSON.stringify(out.repetition);
  }
  return out;
}

export function documentLockReason(record: Row): string | null {
  if (record.status === "draft") return null;
  return "Only drafts can be edited. Revert the document to draft first.";
}

// ------------------------------------------------------------ bookings

async function revenueAccountFor(ctx: Ctx, p: PositionRow, kind: DocKind): Promise<number> {
  if (p.account_id) return p.account_id;
  if (p.item_id) {
    const item = await ctx.db.first<{ type: string }>("SELECT type FROM items WHERE id = ?", p.item_id);
    if (item?.type === "product") return accountIdByNumber(ctx, isSalesKind(kind) ? "3200" : "4200");
  }
  return accountIdByNumber(ctx, isSalesKind(kind) ? SYSTEM_ACCOUNTS.serviceRevenue : SYSTEM_ACCOUNTS.purchasedServices);
}

/**
 * Builds booking lines for a sales document: one line per revenue account and
 * tax code, gross amounts with the exact VAT of the document.
 */
async function documentLines(ctx: Ctx, doc: DocumentRow, receivables: number, reversed: boolean): Promise<EntryLineInput[]> {
  const calc = calculateDocument(doc.positions, doc.vat_mode, await roundingStep(ctx, doc.currency_code));
  const fx = doc.exchange_rate || 1;
  const groups = new Map<string, { account: number; taxId: number | null; amount: number }>();
  for (const [i, p] of doc.positions.entries()) {
    if ((p.type !== "item" && p.type !== "custom") || p.is_optional) continue;
    const account = await revenueAccountFor(ctx, p, doc.kind);
    const key = `${account}:${p.tax_id ?? ""}`;
    const g = groups.get(key) ?? { account, taxId: p.tax_id ?? null, amount: 0 };
    g.amount += calc.lines[i].total;
    groups.set(key, g);
  }
  const lines: EntryLineInput[] = [];
  for (const bucket of calc.vat) {
    const members = [...groups.values()].filter((g) => (g.taxId ?? null) === (bucket.taxId ?? null) || (doc.vat_mode === "none"));
    const sum = members.reduce((s, g) => s + g.amount, 0);
    let allocatedGross = 0;
    let allocatedVat = 0;
    members.forEach((g, idx) => {
      const last = idx === members.length - 1;
      const gross = last ? bucket.gross - allocatedGross : sum ? Math.round((bucket.gross * g.amount) / sum) : 0;
      const vat = last ? bucket.vat - allocatedVat : sum ? Math.round((bucket.vat * g.amount) / sum) : 0;
      allocatedGross += gross;
      allocatedVat += vat;
      if (!gross) return;
      const amount = Math.round(gross * fx);
      lines.push({
        debit_account_id: reversed ? g.account : receivables,
        credit_account_id: reversed ? receivables : g.account,
        amount,
        tax_id: doc.vat_mode === "none" ? null : g.taxId,
        vat_amount: doc.vat_mode === "none" ? null : Math.round(vat * fx),
        description: `${KIND_LABEL[doc.kind]} ${doc.nr ?? ""}`.trim(),
        contact_id: doc.contact_id,
      });
    });
  }
  if (calc.rounding) {
    const roundingAccount = await accountIdByNumber(ctx, "3800");
    const amount = Math.round(Math.abs(calc.rounding) * fx);
    const positive = calc.rounding > 0 !== reversed;
    lines.push({
      debit_account_id: positive ? receivables : roundingAccount,
      credit_account_id: positive ? roundingAccount : receivables,
      amount,
      description: "Rounding difference",
    });
  }
  return lines;
}

async function bookDocument(ctx: Ctx, doc: DocumentRow): Promise<number | null> {
  if (doc.kind !== "invoice" && doc.kind !== "credit_note") return null;
  if (!doc.total) return null;
  const receivables = await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.receivables);
  const lines = await documentLines(ctx, doc, receivables, doc.kind === "credit_note");
  return postEntry(ctx, {
    date: doc.date,
    description: `${KIND_LABEL[doc.kind]} ${doc.nr ?? doc.id}${doc.title ? ` – ${doc.title}` : ""}`,
    type: doc.kind,
    sourceType: "document",
    sourceId: doc.id,
    currency: doc.currency_code,
    exchangeRate: doc.exchange_rate,
    lines,
  });
}

// ------------------------------------------------------------ stock

async function applyStock(ctx: Ctx, doc: DocumentRow, direction: 1 | -1, reason: string) {
  const tracked = await ctx.db.all<{ id: number }>(
    `SELECT id FROM items WHERE is_stock_tracked = 1 AND id IN (${placeholders(Math.max(1, doc.positions.length))})`,
    ...(doc.positions.length ? doc.positions.map((p) => p.item_id ?? 0) : [0]),
  );
  const ids = new Set(tracked.map((t) => t.id));
  const statements = [];
  for (const p of doc.positions) {
    if (!p.item_id || !ids.has(p.item_id) || !p.quantity) continue;
    const qty = direction * p.quantity;
    statements.push(
      {
        sql: "INSERT INTO stock_movements (item_id, date, quantity, reason, document_id, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [p.item_id, today(), qty, reason, doc.id, ctx.actor.name, ctx.actor.name],
      },
      { sql: "UPDATE items SET stock_quantity = stock_quantity + ? WHERE id = ?", params: [qty, p.item_id] },
    );
  }
  if (statements.length) await ctx.db.batch(statements);
}

// ------------------------------------------------------------ workflow

async function reload(ctx: Ctx, doc: { id: number; kind: DocKind }): Promise<DocumentRow> {
  return (await getRecord(ctx, docResource(doc.kind), doc.id)) as unknown as DocumentRow;
}

export async function issueDocument(ctx: Ctx, record: Row): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  if (doc.status !== "draft") throw new AppError("conflict", "Only drafts can be issued.");
  const priced = doc.positions.filter((p) => p.type === "item" || p.type === "custom");
  if (!priced.length && doc.kind !== "delivery") throw new AppError("validation", "Add at least one position before issuing.");
  if (!doc.contact_id && doc.kind !== "purchase_order") throw new AppError("validation", "Select a contact before issuing.", { contact_id: "Required" });

  const patch: Row = { status: doc.kind === "delivery" ? "delivered" : doc.kind === "purchase_order" ? "sent" : "open", issued_at: new Date().toISOString() };
  if (doc.kind === "invoice") {
    const bank = doc.bank_account_id
      ? await ctx.db.first<{ qr_iban: string | null; qr_reference_prefix: string | null }>(
          "SELECT qr_iban, qr_reference_prefix FROM bank_accounts WHERE id = ?",
          doc.bank_account_id,
        )
      : null;
    // QR references need a QR-IBAN; otherwise the PDF uses an RF creditor reference.
    patch.qr_reference = bank?.qr_iban ? createQrReference(`1${String(doc.id).padStart(9, "0")}`, bank.qr_reference_prefix ?? "") : null;
  }
  await patchColumns(ctx, { table: "documents" }, doc.id, patch);
  const issued = await reload(ctx, doc);
  if (doc.kind === "invoice" || doc.kind === "credit_note") {
    const entryId = await bookDocument(ctx, issued);
    if (entryId) await patchColumns(ctx, { table: "documents" }, doc.id, { journal_entry_id: entryId });
  }
  if (doc.kind === "delivery") await applyStock(ctx, issued, -1, "delivery");
  return reload(ctx, doc);
}

export async function revertToDraft(ctx: Ctx, record: Row): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  if (doc.amount_paid) throw new AppError("conflict", "Documents with recorded payments cannot be reverted. Delete the payments first.");
  if (doc.journal_entry_id) await reverseEntry(ctx, doc.journal_entry_id, today(), `Revert to draft ${doc.nr ?? doc.id}`);
  if (doc.kind === "delivery" && doc.status === "delivered") await applyStock(ctx, doc, 1, "delivery_reverted");
  if (doc.kind === "purchase_order" && doc.status === "received") await applyStock(ctx, doc, -1, "receipt_reverted");
  await patchColumns(ctx, { table: "documents" }, doc.id, {
    status: "draft",
    issued_at: null,
    journal_entry_id: null,
    qr_reference: null,
    accepted_at: null,
    rejected_at: null,
  });
  return reload(ctx, doc);
}

export async function cancelDocument(ctx: Ctx, record: Row): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  if (doc.amount_paid) throw new AppError("conflict", "Documents with recorded payments cannot be cancelled. Issue a credit note instead.");
  if (doc.journal_entry_id) await reverseEntry(ctx, doc.journal_entry_id, today(), `Cancellation ${doc.nr ?? doc.id}`);
  if (doc.kind === "delivery" && doc.status === "delivered") await applyStock(ctx, doc, 1, "delivery_cancelled");
  await patchColumns(ctx, { table: "documents" }, doc.id, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    amount_open: 0,
  });
  return reload(ctx, doc);
}

export async function setDocumentStatus(ctx: Ctx, record: Row, status: string, extra: Row = {}): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  await patchColumns(ctx, { table: "documents" }, doc.id, { status, ...extra });
  return reload(ctx, doc);
}

export async function markSent(ctx: Ctx, record: Row): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  if (doc.status === "draft") await issueDocument(ctx, record);
  await patchColumns(ctx, { table: "documents" }, doc.id, { sent_at: new Date().toISOString() });
  return reload(ctx, doc);
}

/** Builds API-shaped payload to duplicate a document into another (or the same) kind. */
function copyPayload(doc: DocumentRow, targetKind: DocKind): Row {
  const sameKind = targetKind === doc.kind;
  return {
    title: doc.title,
    contact_id: doc.contact_id,
    contact_person_id: doc.contact_person_id,
    address: doc.address,
    delivery_address: doc.delivery_address,
    project_id: doc.project_id,
    language: doc.language,
    currency_code: doc.currency_code,
    exchange_rate: doc.exchange_rate,
    vat_mode: doc.vat_mode,
    payment_term_id: doc.payment_term_id,
    bank_account_id: doc.bank_account_id,
    reference: doc.reference ?? (sameKind ? null : doc.nr),
    header: sameKind ? doc.header : undefined,
    footer: sameKind ? doc.footer : undefined,
    source_id: sameKind ? null : doc.id,
    date: today(),
    positions: doc.positions
      .filter((p) => targetKind === "quote" || !p.is_optional)
      .map((p) => ({
        type: p.type,
        item_id: p.item_id,
        code: p.code,
        text: p.text,
        quantity: p.quantity,
        unit_name: p.unit_name,
        unit_price: p.unit_price,
        discount_percent: p.discount_percent,
        tax_id: targetKind === "purchase_order" || doc.kind === "purchase_order" ? null : p.tax_id,
        account_id: p.account_id,
        is_optional: Boolean(p.is_optional),
      })),
  };
}

export async function copyDocument(ctx: Ctx, record: Row, targetKind?: DocKind): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  const kind = targetKind ?? doc.kind;
  const created = await createRecord(ctx, docResource(kind), copyPayload(doc, kind), {
    trusted: true,
    auditSummary: `${KIND_LABEL[kind]} created from ${KIND_LABEL[doc.kind].toLowerCase()} ${doc.nr ?? doc.id}`,
  });
  return created as unknown as DocumentRow;
}

export async function convertDocument(ctx: Ctx, record: Row, targetKind: DocKind): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  const created = await copyDocument(ctx, record, targetKind);
  if (doc.kind === "quote" && doc.status !== "accepted") {
    await patchColumns(ctx, { table: "documents" }, doc.id, { status: "accepted", accepted_at: new Date().toISOString() });
  }
  if (doc.kind === "order" && targetKind === "invoice" && doc.status === "open" && !doc.repetition) {
    await patchColumns(ctx, { table: "documents" }, doc.id, { status: "done" });
  }
  return created;
}

// ------------------------------------------------------------ payments

export interface PaymentInput {
  date: string;
  amount: number; // cents
  bank_account_id?: number | null;
  payment_type_id?: number | null;
  title?: string | null;
  is_cash_discount?: boolean | number | null;
  bank_transaction_id?: number | null;
}

async function refreshPaymentStatus(ctx: Ctx, docId: number) {
  const doc = await ctx.db.first<{ total: number; status: string; kind: string }>("SELECT total, status, kind FROM documents WHERE id = ?", docId);
  if (!doc) return;
  const paid = (await ctx.db.value<number>("SELECT COALESCE(SUM(amount), 0) FROM document_payments WHERE document_id = ?", docId)) ?? 0;
  const open = doc.total - paid;
  let status = doc.status;
  if (doc.status !== "cancelled" && doc.status !== "draft") {
    if (open <= 0) status = doc.kind === "credit_note" ? "settled" : "paid";
    else if (paid > 0) status = "partial";
    else status = "open";
  }
  await patchColumns(ctx, { table: "documents" }, docId, {
    amount_paid: paid,
    amount_open: Math.max(0, open),
    status,
    paid_at: open <= 0 ? new Date().toISOString() : null,
  });
}

export async function recordPayment(ctx: Ctx, record: Row, input: PaymentInput): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  if (!["open", "partial"].includes(doc.status)) throw new AppError("conflict", "Payments can only be recorded on open documents.");
  if (!input.amount || input.amount <= 0) throw new AppError("validation", "Amount must be positive.", { amount: "Must be positive" });
  if (input.amount > doc.amount_open) {
    throw new AppError("validation", "The payment exceeds the open amount.", { amount: "Exceeds open amount" });
  }

  const receivables = await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.receivables);
  const bankAccountId =
    input.bank_account_id ??
    doc.bank_account_id ??
    (await ctx.db.value<number>("SELECT id FROM bank_accounts ORDER BY is_default DESC, id LIMIT 1"));
  const ledger = bankAccountId
    ? await ctx.db.value<number>("SELECT account_id FROM bank_accounts WHERE id = ?", bankAccountId)
    : null;
  const bankLedger = ledger ?? (await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.bank));
  const fx = doc.exchange_rate || 1;
  const amount = Math.round(input.amount * fx);
  const isRefund = doc.kind === "credit_note";

  let lines: EntryLineInput[];
  if (input.is_cash_discount) {
    const discountAccount = await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.cashDiscountGranted);
    const mainTax = [...doc.positions].filter((p) => p.tax_id).sort((a, b) => b.total - a.total)[0]?.tax_id ?? null;
    lines = [{ debit_account_id: discountAccount, credit_account_id: receivables, amount, tax_id: mainTax, description: "Cash discount" }];
  } else {
    lines = [
      isRefund
        ? { debit_account_id: receivables, credit_account_id: bankLedger, amount, description: input.title ?? "Refund" }
        : { debit_account_id: bankLedger, credit_account_id: receivables, amount, description: input.title ?? "Payment received" },
    ];
  }
  const entryId = await postEntry(ctx, {
    date: input.date,
    description: `${isRefund ? "Refund" : "Payment"} ${KIND_LABEL[doc.kind].toLowerCase()} ${doc.nr ?? doc.id}`,
    type: "payment",
    sourceType: "document",
    sourceId: doc.id,
    lines,
  });
  await ctx.db.run(
    `INSERT INTO document_payments (document_id, date, amount, bank_account_id, payment_type_id, is_cash_discount, title, bank_transaction_id, journal_entry_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    doc.id,
    input.date,
    input.amount,
    bankAccountId,
    input.payment_type_id ?? null,
    input.is_cash_discount ? 1 : 0,
    input.title ?? null,
    input.bank_transaction_id ?? null,
    entryId,
    ctx.actor.name,
    ctx.actor.name,
  );
  await refreshPaymentStatus(ctx, doc.id);
  return reload(ctx, doc);
}

export async function deletePayment(ctx: Ctx, record: Row, paymentId: number): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  const payment = await ctx.db.first<{ id: number; journal_entry_id: number | null; bank_transaction_id: number | null; amount: number }>(
    "SELECT * FROM document_payments WHERE id = ? AND document_id = ?",
    paymentId,
    doc.id,
  );
  if (!payment) throw new AppError("not_found", "Payment not found.");
  if (payment.journal_entry_id) await reverseEntry(ctx, payment.journal_entry_id, today(), `Payment deleted ${doc.nr ?? doc.id}`);
  await ctx.db.batch([
    { sql: "DELETE FROM document_payments WHERE id = ?", params: [payment.id] },
    ...(payment.bank_transaction_id
      ? [{ sql: "UPDATE bank_transactions SET status = 'unmatched', match_type = NULL, match_id = NULL, journal_entry_id = NULL WHERE id = ?", params: [payment.bank_transaction_id] }]
      : []),
  ]);
  await refreshPaymentStatus(ctx, doc.id);
  await audit(ctx, { action: "delete_payment", resource: KIND_RESOURCE[doc.kind], resourceId: doc.id, summary: `Deleted payment of ${(payment.amount / 100).toFixed(2)}` });
  return reload(ctx, doc);
}

/** Writes off the open amount as a bad debt (3805), including the VAT correction. */
export async function writeOff(ctx: Ctx, record: Row, date: string): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  if (!doc.amount_open) throw new AppError("conflict", "Nothing left to write off.");
  const [receivables, loss] = await Promise.all([
    accountIdByNumber(ctx, SYSTEM_ACCOUNTS.receivables),
    accountIdByNumber(ctx, "3805"),
  ]);
  const mainTax = [...doc.positions].filter((p) => p.tax_id).sort((a, b) => b.total - a.total)[0]?.tax_id ?? null;
  const entryId = await postEntry(ctx, {
    date,
    description: `Bad debt write-off ${doc.nr ?? doc.id}`,
    type: "payment",
    sourceType: "document",
    sourceId: doc.id,
    lines: [{ debit_account_id: loss, credit_account_id: receivables, amount: Math.round(doc.amount_open * (doc.exchange_rate || 1)), tax_id: mainTax, description: "Bad debt" }],
  });
  await ctx.db.run(
    `INSERT INTO document_payments (document_id, date, amount, title, journal_entry_id, created_by, updated_by) VALUES (?, ?, ?, 'Write-off', ?, ?, ?)`,
    doc.id,
    date,
    doc.amount_open,
    entryId,
    ctx.actor.name,
    ctx.actor.name,
  );
  await refreshPaymentStatus(ctx, doc.id);
  await patchColumns(ctx, { table: "documents" }, doc.id, { status: "written_off" });
  return reload(ctx, doc);
}

// ------------------------------------------------------------ reminders

export async function createReminder(ctx: Ctx, record: Row): Promise<number> {
  const doc = record as unknown as DocumentRow;
  if (!["open", "partial"].includes(doc.status)) throw new AppError("conflict", "Only open invoices can be reminded.");
  const level = Math.min(3, (doc.reminder_level ?? 0) + 1);
  const accounting = await getSettings(ctx, "accounting");
  const texts = await getSettings(ctx, "texts");
  const fee = toCents(accounting.reminder_fees[level - 1] ?? 0);
  const reminderLabel = t(doc.language, "reminder");
  const result = await ctx.db.run(
    `INSERT INTO reminders (document_id, level, date, due_date, fee, title, header, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    doc.id,
    level,
    today(),
    addDays(today(), accounting.reminder_days),
    fee,
    `${level}. ${reminderLabel} – ${doc.nr ?? doc.id}`,
    documentText(texts, doc.language, "reminder_header"),
    ctx.actor.name,
    ctx.actor.name,
  );
  await patchColumns(ctx, { table: "documents" }, doc.id, { reminder_level: level });
  return result.lastRowId;
}

/** Creates reminders for every overdue invoice that has not been reminded in the last `days` days. */
export async function remindOverdue(ctx: Ctx): Promise<number> {
  const accounting = await getSettings(ctx, "accounting");
  const due = await ctx.db.all<{ id: number }>(
    `SELECT d.id FROM documents d
     WHERE d.kind = 'invoice' AND d.status IN ('open','partial') AND d.due_date < ? AND d.reminder_level < 3
       AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.document_id = d.id AND r.date > ?)`,
    today(),
    addDays(today(), -accounting.reminder_days),
  );
  for (const row of due) {
    const record = await getRecord(ctx, docResource("invoice"), row.id);
    await createReminder(ctx, record);
  }
  return due.length;
}

// ------------------------------------------------------------ recurring

export interface Repetition {
  interval: "daily" | "weekly" | "monthly" | "quarterly" | "semiannual" | "yearly";
  every?: number;
  start: string;
  end?: string | null;
}

export function nextRunDate(rep: Repetition, from: string): string {
  const every = Math.max(1, rep.every ?? 1);
  switch (rep.interval) {
    case "daily":
      return addDays(from, every);
    case "weekly":
      return addDays(from, 7 * every);
    case "quarterly":
      return addMonths(from, 3 * every);
    case "semiannual":
      return addMonths(from, 6 * every);
    case "yearly":
      return addMonths(from, 12 * every);
    default:
      return addMonths(from, every);
  }
}

/** Generates invoices for recurring sales orders that are due. */
export async function runRecurring(ctx: Ctx, asOf = today()): Promise<number[]> {
  const orders = await ctx.db.all<{ id: number; repetition: string; next_run_date: string | null }>(
    "SELECT id, repetition, next_run_date FROM documents WHERE kind = 'order' AND status = 'open' AND repetition IS NOT NULL",
  );
  const created: number[] = [];
  for (const order of orders) {
    let parsed: Repetition | null = null;
    try {
      parsed = JSON.parse(order.repetition) as Repetition;
    } catch {
      parsed = null;
    }
    if (!parsed?.start) continue;
    let next = order.next_run_date ?? parsed.start;
    while (next <= asOf && (!parsed.end || next <= parsed.end)) {
      const record = await getRecord(ctx, docResource("order"), order.id);
      const invoice = await copyDocument(ctx, record, "invoice");
      await patchColumns(ctx, { table: "documents" }, invoice.id, { date: next });
      created.push(invoice.id);
      next = nextRunDate(parsed, next);
    }
    await patchColumns(ctx, { table: "documents" }, order.id, { next_run_date: next });
  }
  return created;
}

/** Reconciles stock when a purchase order is received. */
export async function receivePurchaseOrder(ctx: Ctx, record: Row): Promise<DocumentRow> {
  const doc = record as unknown as DocumentRow;
  await applyStock(ctx, doc, 1, "purchase_receipt");
  await patchColumns(ctx, { table: "documents" }, doc.id, { status: "received" });
  return reload(ctx, doc);
}

/** Creates a supplier bill from a purchase order. */
export async function billFromPurchaseOrder(ctx: Ctx, record: Row): Promise<Row> {
  const doc = record as unknown as DocumentRow;
  const expense = await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.purchasedServices);
  const bills = getResource("bills")!;
  return createRecord(
    ctx,
    bills,
    {
      contact_id: doc.contact_id,
      title: doc.title ?? `Purchase order ${doc.nr ?? doc.id}`,
      date: today(),
      currency_code: doc.currency_code,
      vat_mode: doc.vat_mode === "none" ? "incl" : doc.vat_mode,
      project_id: doc.project_id,
      lines: doc.positions
        .filter((p) => p.type === "item" || p.type === "custom")
        .map((p) => ({
          text: p.text,
          amount: p.total / 100,
          tax_id: p.tax_id,
          account_id: p.account_id ?? expense,
        })),
    },
    { trusted: true },
  );
}
