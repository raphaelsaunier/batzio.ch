import { splitAmount } from "@batzio/core/calc/documents";
import { addDays, today } from "@batzio/core/format";
import type { Row } from "./resources/types";
import { SYSTEM_ACCOUNTS } from "@batzio/core/swiss/chart-of-accounts";
import { accountIdByNumber, postEntry, reverseEntry, type EntryLineInput } from "./accounting";
import { patchColumns } from "./crud";
import type { Ctx } from "./ctx";
import { AppError } from "./errors";
import { loadContact } from "./sales";
import { getSettings } from "./settings";

export interface BillLine {
  id?: number;
  text: string | null;
  amount: number;
  tax_id: number | null;
  tax_rate: number;
  account_id: number | null;
}

export interface BillRow {
  id: number;
  nr: string | null;
  vendor_nr: string | null;
  contact_id: number | null;
  title: string | null;
  date: string;
  due_date: string | null;
  currency_code: string;
  exchange_rate: number;
  vat_mode: "incl" | "excl";
  status: string;
  total_net: number;
  total_vat: number;
  total: number;
  amount_paid: number;
  amount_open: number;
  iban: string | null;
  qr_reference: string | null;
  payment_message: string | null;
  journal_entry_id: number | null;
  lines: BillLine[];
}

export async function prepareBill(ctx: Ctx, data: Row, existing: Row | null): Promise<Row> {
  const out: Row = { ...data };
  const merged = { ...(existing ?? {}), ...data } as unknown as BillRow;
  if (merged.contact_id && (data.contact_id !== undefined || !existing)) {
    const supplier = await loadContact(ctx, merged.contact_id);
    if (!supplier) throw new AppError("validation", "Supplier not found.", { contact_id: "Unknown contact" });
    if (!merged.iban && supplier.iban) out.iban = supplier.iban;
    if (!existing && !data.due_date) {
      const days = supplier.payment_term_id
        ? await ctx.db.value<number>("SELECT days FROM payment_terms WHERE id = ?", supplier.payment_term_id)
        : null;
      out.due_date = addDays(String(merged.date ?? today()), days ?? (await getSettings(ctx, "accounting")).default_payment_days);
    }
  }
  if (!existing) out.date ??= today();

  const vatMode = (merged.vat_mode ?? "incl") as "incl" | "excl";
  const lines = (data.lines as BillLine[] | undefined) ?? (existing?.lines as BillLine[] | undefined) ?? [];
  if (data.lines !== undefined || data.vat_mode !== undefined || !existing) {
    const taxes = new Map((await ctx.db.all<{ id: number; rate: number }>("SELECT id, rate FROM taxes")).map((t) => [t.id, t.rate]));
    const fallbackAccount = await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.purchasedServices);
    const enriched = lines.map((l, i) => ({
      ...l,
      sort: i,
      tax_rate: l.tax_id ? (taxes.get(Number(l.tax_id)) ?? 0) : 0,
      account_id: l.account_id ?? fallbackAccount,
      amount: Math.round(Number(l.amount ?? 0)),
    }));
    let net = 0;
    let vat = 0;
    for (const l of enriched) {
      const s = splitAmount(l.amount, l.tax_rate, vatMode);
      net += s.net;
      vat += s.vat;
    }
    if (data.lines !== undefined) out.lines = enriched;
    out.total_net = net;
    out.total_vat = vat;
    out.total = net + vat;
    out.amount_open = net + vat - Number(existing?.amount_paid ?? 0);
  }
  return out;
}

export function billLockReason(record: Row): string | null {
  return record.status === "draft" ? null : "Booked bills cannot be edited. Revert the bill to draft first.";
}

async function bankLedger(ctx: Ctx, bankAccountId: number | null | undefined): Promise<{ bankAccountId: number | null; ledger: number }> {
  const id =
    bankAccountId ?? (await ctx.db.value<number>("SELECT id FROM bank_accounts ORDER BY is_default DESC, id LIMIT 1"));
  const ledger = id ? await ctx.db.value<number>("SELECT account_id FROM bank_accounts WHERE id = ?", id) : null;
  return { bankAccountId: id ?? null, ledger: ledger ?? (await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.bank)) };
}

export async function bookBill(ctx: Ctx, record: Row): Promise<void> {
  const bill = record as unknown as BillRow;
  if (bill.status !== "draft") throw new AppError("conflict", "Only draft bills can be booked.");
  if (!bill.lines.length || !bill.total) throw new AppError("validation", "Add at least one line with an amount.");
  if (!bill.contact_id) throw new AppError("validation", "Select a supplier.", { contact_id: "Required" });
  const payables = await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.payables);
  const fx = bill.exchange_rate || 1;
  const lines: EntryLineInput[] = bill.lines.map((l) => {
    const s = splitAmount(l.amount, l.tax_rate, bill.vat_mode);
    return {
      debit_account_id: l.account_id!,
      credit_account_id: payables,
      amount: Math.round(s.gross * fx),
      tax_id: l.tax_id,
      vat_amount: l.tax_id ? Math.round(s.vat * fx) : null,
      description: l.text ?? bill.title ?? null,
      contact_id: bill.contact_id,
    };
  });
  const entryId = await postEntry(ctx, {
    date: bill.date,
    description: `Supplier bill ${bill.nr ?? bill.id}${bill.vendor_nr ? ` (${bill.vendor_nr})` : ""}${bill.title ? ` – ${bill.title}` : ""}`,
    type: "bill",
    sourceType: "bill",
    sourceId: bill.id,
    currency: bill.currency_code,
    exchangeRate: fx,
    lines,
  });
  await patchColumns(ctx, { table: "bills" }, bill.id, {
    status: "booked",
    journal_entry_id: entryId,
    booked_at: new Date().toISOString(),
  });
}

export async function revertBill(ctx: Ctx, record: Row): Promise<void> {
  const bill = record as unknown as BillRow;
  if (bill.amount_paid) throw new AppError("conflict", "Bills with payments cannot be reverted.");
  if (bill.journal_entry_id) await reverseEntry(ctx, bill.journal_entry_id, today(), `Revert bill ${bill.nr ?? bill.id}`);
  await ctx.db.run("UPDATE outgoing_payments SET status = 'cancelled' WHERE bill_id = ? AND status IN ('open','exported')", bill.id);
  await patchColumns(ctx, { table: "bills" }, bill.id, { status: "draft", journal_entry_id: null, booked_at: null });
}

export async function cancelBill(ctx: Ctx, record: Row): Promise<void> {
  const bill = record as unknown as BillRow;
  if (bill.amount_paid) throw new AppError("conflict", "Bills with payments cannot be cancelled.");
  if (bill.journal_entry_id) await reverseEntry(ctx, bill.journal_entry_id, today(), `Cancel bill ${bill.nr ?? bill.id}`);
  await ctx.db.run("UPDATE outgoing_payments SET status = 'cancelled' WHERE bill_id = ? AND status IN ('open','exported')", bill.id);
  await patchColumns(ctx, { table: "bills" }, bill.id, { status: "cancelled", amount_open: 0 });
}

export async function refreshBillStatus(ctx: Ctx, billId: number) {
  const bill = await ctx.db.first<{ total: number; status: string }>("SELECT total, status FROM bills WHERE id = ?", billId);
  if (!bill || bill.status === "draft" || bill.status === "cancelled") return;
  const paid =
    (await ctx.db.value<number>("SELECT COALESCE(SUM(amount), 0) FROM outgoing_payments WHERE bill_id = ? AND status = 'paid'", billId)) ?? 0;
  const open = bill.total - paid;
  await patchColumns(ctx, { table: "bills" }, billId, {
    amount_paid: paid,
    amount_open: Math.max(0, open),
    status: open <= 0 ? "paid" : paid > 0 ? "partial" : "booked",
  });
}

/** Schedules a payment order for a booked bill (exported later as pain.001). */
export async function schedulePayment(
  ctx: Ctx,
  record: Row,
  input: { execution_date?: string | null; amount?: number | null; bank_account_id?: number | null },
): Promise<number> {
  const bill = record as unknown as BillRow;
  if (!["booked", "partial"].includes(bill.status)) throw new AppError("conflict", "Book the bill before scheduling a payment.");
  const scheduled =
    (await ctx.db.value<number>("SELECT COALESCE(SUM(amount), 0) FROM outgoing_payments WHERE bill_id = ? AND status IN ('open','exported')", bill.id)) ?? 0;
  const amount = input.amount ?? bill.amount_open - scheduled;
  if (amount <= 0) throw new AppError("conflict", "The bill is already fully scheduled or paid.");
  if (!bill.iban) throw new AppError("validation", "The bill has no IBAN to pay to.", { iban: "Required" });
  const supplier = await loadContact(ctx, bill.contact_id);
  const { bankAccountId } = await bankLedger(ctx, input.bank_account_id);
  const res = await ctx.db.run(
    `INSERT INTO outgoing_payments (bill_id, contact_id, execution_date, amount, currency_code, bank_account_id, recipient_name, iban, qr_reference, message, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    bill.id,
    bill.contact_id,
    input.execution_date ?? (bill.due_date && bill.due_date > today() ? bill.due_date : today()),
    amount,
    bill.currency_code,
    bankAccountId,
    supplier ? (supplier.type === "person" ? `${supplier.name_2 ?? ""} ${supplier.name_1}`.trim() : supplier.name_1) : null,
    bill.iban,
    bill.qr_reference,
    bill.payment_message ?? bill.vendor_nr ?? bill.nr,
    ctx.actor.name,
    ctx.actor.name,
  );
  return res.lastRowId;
}

export interface OutgoingPaymentRow {
  id: number;
  bill_id: number | null;
  contact_id: number | null;
  execution_date: string;
  amount: number;
  currency_code: string;
  bank_account_id: number | null;
  recipient_name: string | null;
  iban: string | null;
  qr_reference: string | null;
  message: string | null;
  status: string;
  journal_entry_id: number | null;
}

export async function markOutgoingPaid(ctx: Ctx, record: Row, date: string): Promise<void> {
  const p = record as unknown as OutgoingPaymentRow;
  if (p.status === "paid") throw new AppError("conflict", "Payment is already marked as paid.");
  if (p.status === "cancelled") throw new AppError("conflict", "Cancelled payments cannot be paid.");
  const payables = await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.payables);
  const { ledger } = await bankLedger(ctx, p.bank_account_id);
  const fx = p.bill_id ? ((await ctx.db.value<number>("SELECT exchange_rate FROM bills WHERE id = ?", p.bill_id)) ?? 1) : 1;
  const entryId = await postEntry(ctx, {
    date,
    description: `Payment to ${p.recipient_name ?? "supplier"}${p.message ? ` – ${p.message}` : ""}`,
    type: "bill_payment",
    sourceType: "outgoing_payment",
    sourceId: p.id,
    lines: [{ debit_account_id: payables, credit_account_id: ledger, amount: Math.round(p.amount * fx), contact_id: p.contact_id }],
  });
  await patchColumns(ctx, { table: "outgoing_payments" }, p.id, { status: "paid", paid_at: date, journal_entry_id: entryId });
  if (p.bill_id) await refreshBillStatus(ctx, p.bill_id);
}

export async function cancelOutgoing(ctx: Ctx, record: Row): Promise<void> {
  const p = record as unknown as OutgoingPaymentRow;
  if (p.status === "paid" && p.journal_entry_id) await reverseEntry(ctx, p.journal_entry_id, today(), "Payment cancelled");
  await patchColumns(ctx, { table: "outgoing_payments" }, p.id, { status: "cancelled" });
  if (p.bill_id) await refreshBillStatus(ctx, p.bill_id);
}

/** Records an already executed payment on a bill. */
export async function payBill(ctx: Ctx, record: Row, input: { date: string; amount?: number | null; bank_account_id?: number | null }) {
  const bill = record as unknown as BillRow;
  const id = await schedulePayment(ctx, record, { execution_date: input.date, amount: input.amount ?? bill.amount_open, bank_account_id: input.bank_account_id });
  const payment = await ctx.db.first<Row>("SELECT * FROM outgoing_payments WHERE id = ?", id);
  await markOutgoingPaid(ctx, payment!, input.date);
}

// --------------------------------------------------------------- expenses

export interface ExpenseRow {
  id: number;
  nr: string | null;
  title: string;
  date: string;
  contact_id: number | null;
  amount: number;
  tax_id: number | null;
  account_id: number | null;
  payment_account_id: number | null;
  status: string;
  journal_entry_id: number | null;
}

export async function prepareExpense(ctx: Ctx, data: Row, existing: Row | null): Promise<Row> {
  const out: Row = { ...data };
  if (!existing) {
    out.account_id ??= await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.adminExpense);
    out.payment_account_id ??= await accountIdByNumber(ctx, SYSTEM_ACCOUNTS.cash);
  }
  return out;
}

export async function bookExpense(ctx: Ctx, record: Row): Promise<void> {
  const e = record as unknown as ExpenseRow;
  if (e.status !== "draft") throw new AppError("conflict", "Only draft expenses can be booked.");
  if (!e.amount) throw new AppError("validation", "Enter an amount.", { amount: "Required" });
  const entryId = await postEntry(ctx, {
    date: e.date,
    description: `Expense ${e.nr ?? e.id} – ${e.title}`,
    type: "expense",
    sourceType: "expense",
    sourceId: e.id,
    lines: [
      {
        debit_account_id: e.account_id!,
        credit_account_id: e.payment_account_id!,
        amount: e.amount,
        tax_id: e.tax_id,
        description: e.title,
        contact_id: e.contact_id,
      },
    ],
  });
  await patchColumns(ctx, { table: "expenses" }, e.id, { status: "booked", journal_entry_id: entryId });
}

export async function revertExpense(ctx: Ctx, record: Row): Promise<void> {
  const e = record as unknown as ExpenseRow;
  if (e.journal_entry_id) await reverseEntry(ctx, e.journal_entry_id, today(), `Revert expense ${e.nr ?? e.id}`);
  await patchColumns(ctx, { table: "expenses" }, e.id, { status: "draft", journal_entry_id: null });
}
