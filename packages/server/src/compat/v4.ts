import { today } from "@batzio/core/format";
import { splitAmount } from "@batzio/core/calc/documents";
import { createRecord, deleteRecord, getRecord, toApi, updateRecord } from "../crud";
import { assertCan, type Ctx } from "../ctx";
import { AppError, notFound } from "../errors";
import { previewNumber } from "../numbering";
import { renderPayslipPdf } from "../pdf/reports";
import { bookBill, bookExpense, cancelBill, cancelOutgoing, revertBill, revertExpense, schedulePayment } from "../purchases";
import { getResource } from "../resources/registry";
import type { Row } from "../resources/types";
import { loadExtras, saveExtras } from "./extras";
import { has } from "./table";
import type { Columns } from "./wire";
import { bodyObject, bool, created, raw, date, idFromUuid, isoDatetime, noContent, ok, pageEnvelope, pagePaging, route, sortOrder, uuidFor, TAG, type CompatCall, type Route } from "./wire";

const money = (cents: unknown) => Math.round(Number(cents ?? 0)) / 100;

/** Unset text is null on the wire, never an empty string. */
function blanksToNull<T>(value: T): T {
  if (Array.isArray(value)) return value.map(blanksToNull) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v === "" ? null : blanksToNull(v)])) as T;
  return value;
}
const res = (name: string) => getResource(name)!;

export async function contactName(ctx: Ctx, id: unknown): Promise<{ first: string | null; last: string | null; type: "PRIVATE" | "COMPANY"; row: Row | null }> {
  const c = id ? await ctx.db.first<Row>("SELECT * FROM contacts WHERE id = ?", id) : null;
  if (!c) return { first: null, last: null, type: "COMPANY", row: null };
  return c.type === "person" ? { first: (c.name_2 as string) || null, last: String(c.name_1), type: "PRIVATE", row: c } : { first: null, last: String(c.name_1), type: "COMPANY", row: c };
}

async function addressOf(ctx: Ctx, contactId: unknown) {
  const n = await contactName(ctx, contactId);
  const c = n.row;
  return {
    title: null,
    salutation: null,
    firstname_suffix: n.first,
    lastname_company: n.last,
    address_line: c ? [c.street, c.house_number].filter(Boolean).join(" ") : "",
    postcode: (c?.postcode as string) ?? "",
    city: (c?.city as string) ?? "",
    country_code: (c?.country_code as string) ?? "CH",
    main_contact_id: c ? Number(c.id) : null,
    contact_address_id: null,
    type: n.type,
  };
}

/** Bank account id ↔ the ledger account Batzio stores on expenses. */
async function bankAccountFor(ctx: Ctx, ledgerAccountId: unknown) {
  if (!ledgerAccountId) return null;
  return (await ctx.db.value<number>("SELECT id FROM bank_accounts WHERE account_id = ? ORDER BY is_default DESC, id LIMIT 1", ledgerAccountId)) ?? null;
}

const attachmentIds = (fileId: unknown) => (fileId ? [uuidFor(TAG.file, Number(fileId))] : []);
/** Batzio keeps one receipt per bill or expense: the first attachment. */
async function firstAttachment(ctx: Ctx, ids: unknown): Promise<number | null> {
  if (!Array.isArray(ids) || !ids.length) return null;
  let id: number | null = null;
  try {
    id = idFromUuid(String(ids[0]), TAG.file);
  } catch {
    id = null;
  }
  if (!id || !(await ctx.db.value("SELECT id FROM files WHERE id = ?", id))) {
    throw new AppError("validation", "Unknown attachment {id}.", { attachment_ids: "Unknown file" }, { id: String(ids[0]) });
  }
  return id;
}

// ------------------------------------------------------------------ banking payments

const PAYMENT_STATUS: Record<string, string> = { open: "open", exported: "downloaded", paid: "paid", cancelled: "cancelled" };

async function readBankingPaymentRaw(ctx: Ctx, r: Row): Promise<Row> {
  const bank = r.bank_account_id ? await ctx.db.first<Row>("SELECT id, iban FROM bank_accounts WHERE id = ?", r.bank_account_id) : null;
  const extras = (await loadExtras(ctx, "outgoing_payments", [Number(r.id)])).get(Number(r.id)) ?? {};
  const contact = (await contactName(ctx, r.contact_id)).row;
  const address = (extras.recipient as Row | undefined)?.address as Row | undefined;
  return {
    id: r.id,
    uuid: uuidFor(TAG.outgoing_payment, Number(r.id)),
    sender: { id: bank?.id ?? null, uuid: uuidFor(TAG.bank_account, Number(bank?.id ?? 0)), iban: bank?.iban ?? "" },
    recipient: {
      name: r.recipient_name ?? "",
      iban: r.iban ?? "",
      address: {
        street_name: (address?.street_name as string) ?? (contact?.street as string) ?? "",
        house_number: (address?.house_number as string) ?? (contact?.house_number as string) ?? null,
        zip: (address?.zip as string) ?? (contact?.postcode as string) ?? "",
        city: (address?.city as string) ?? (contact?.city as string) ?? "",
        country_code: (address?.country_code as string) ?? (contact?.country_code as string) ?? "CH",
      },
    },
    amount: money(r.amount),
    currency: r.currency_code ?? "CHF",
    execution_date: date(r.execution_date),
    allowance: (extras.allowance as string) ?? "no_fee",
    is_salary: bool(extras.is_salary),
    instruction_id: `BZ-${r.id}`,
    purchase_reference: { bill_id: uuidFor(TAG.bill, Number(r.bill_id)), bill_payment_id: uuidFor(TAG.outgoing_payment, Number(r.id)) },
    document_no: null,
    qr_reference_number: r.qr_reference ?? null,
    additional_information: r.message ?? null,
    status: PAYMENT_STATUS[String(r.status)] ?? "open",
    type: r.qr_reference ? "qr" : "iban",
    due_date: date(r.execution_date),
    created_at: isoDatetime(r.created_at),
    is_editing_restricted: bool(extras.is_editing_restricted),
  };
}

async function paymentInput(ctx: Ctx, b: Row): Promise<Row> {
  const out: Row = {};
  if (has(b, "account_id")) {
    const id = idFromUuid(String(b.account_id), TAG.bank_account);
    if (!(await ctx.db.value("SELECT id FROM bank_accounts WHERE id = ?", id))) throw new AppError("validation", "Unknown bank account.");
    out.bank_account_id = id;
  }
  if (has(b, "amount")) out.amount = Number(b.amount);
  if (has(b, "currency")) out.currency_code = String(b.currency).toUpperCase();
  if (has(b, "execution_date")) out.execution_date = date(b.execution_date);
  if (has(b, "qr_reference_number")) out.qr_reference = b.qr_reference_number || null;
  if (has(b, "additional_information") || has(b, "message")) out.message = (b.additional_information ?? b.message) || null;
  const recipient = b.recipient as Row | undefined;
  const country = (recipient?.address as Row | undefined)?.country_code;
  if (country !== undefined && !/^[A-Za-z]{2}$/.test(String(country))) throw new AppError("validation", "Use a two-letter country code.", { country_code: "Invalid" });
  if (recipient) {
    out.recipient_name = recipient.name ?? null;
    out.iban = recipient.iban ?? null;
  }
  const ref = b.purchase_reference as Row | undefined;
  if (ref?.bill_id) {
    const billId = idFromUuid(String(ref.bill_id), TAG.bill);
    const bill = await ctx.db.first<Row>("SELECT id, contact_id FROM bills WHERE id = ?", billId);
    if (!bill) throw new AppError("validation", "Unknown bill.");
    out.bill_id = bill.id;
    out.contact_id = bill.contact_id;
  }
  return out;
}

async function outgoing(ctx: Ctx, raw: string): Promise<Row> {
  assertCan(ctx, "purchases", "read");
  const row = await ctx.db.first<Row>("SELECT * FROM outgoing_payments WHERE id = ?", idFromUuid(raw, TAG.outgoing_payment));
  if (!row) throw notFound("Payment");
  return row;
}

function bankingPaymentRoutes(): Route[] {
  const r = () => res("outgoing_payments");
  return [
    route("GET", "/4.0/banking/payments", async (c) => {
      assertCan(c.ctx, "purchases", "read");
      const p = pagePaging(c.query);
      const filter = c.query.get("filter-by");
      const rows = await c.ctx.db.all<Row>(
        `SELECT * FROM outgoing_payments${filter ? " WHERE status = ?" : ""} ORDER BY execution_date DESC, id DESC LIMIT ? OFFSET ?`,
        ...(filter ? [Object.entries(PAYMENT_STATUS).find(([, v]) => v === filter)?.[0] ?? filter] : []),
        p.limit,
        p.offset,
      );
      return Promise.all(rows.map((x) => readBankingPayment(c.ctx, x)));
    }),
    route("POST", "/4.0/banking/payments", async (c) => {
      const b = bodyObject(c);
      for (const k of ["account_id", "amount", "currency", "execution_date", "recipient", "type"]) if (!has(b, k)) throw new AppError("validation", "The field {field} is required.", undefined, { field: k });
      const row = await createRecord(c.ctx, r(), { ...(await paymentInput(c.ctx, b)), status: "open" });
      await saveExtras(c.ctx, "outgoing_payments", Number(row.id), b, ["allowance", "is_salary", "recipient", "is_editing_restricted"]);
      return created(await readBankingPayment(c.ctx, await outgoing(c.ctx, String(row.id))));
    }),
    route("GET", "/4.0/banking/payments/{payment_id}", async (c) => readBankingPayment(c.ctx, await outgoing(c.ctx, c.params.payment_id))),
    route("PUT", "/4.0/banking/payments/{payment_id}", async (c) => {
      const row = await outgoing(c.ctx, c.params.payment_id);
      const b = bodyObject(c);
      await updateRecord(c.ctx, r(), Number(row.id), await paymentInput(c.ctx, b));
      await saveExtras(c.ctx, "outgoing_payments", Number(row.id), b, ["allowance", "is_salary", "recipient", "is_editing_restricted"]);
      return readBankingPayment(c.ctx, await outgoing(c.ctx, String(row.id)));
    }),
    route("DELETE", "/4.0/banking/payments/{payment_id}", async (c) => {
      const row = await outgoing(c.ctx, c.params.payment_id);
      await deleteRecord(c.ctx, r(), Number(row.id));
      return ok;
    }),
    route("POST", "/4.0/banking/payments/{payment_id}/cancel", async (c) => {
      const row = await outgoing(c.ctx, c.params.payment_id);
      await cancelOutgoing(c.ctx, row);
      return readBankingPayment(c.ctx, await outgoing(c.ctx, String(row.id)));
    }),
  ];
}

// ------------------------------------------------------------------ bills

function billStatus(r: Row, payments: Row[]): string {
  if (r.status === "paid") return "PAID";
  if (r.status === "partial") return "PARTIALLY_PAID";
  if (r.status === "draft" || r.status === "cancelled") return "DRAFT";
  const live = payments.filter((p) => p.status === "open" || p.status === "exported");
  if (live.some((p) => p.status === "exported")) return "DOWNLOADED";
  if (live.length) return "CREATED";
  return "BOOKED";
}

async function readBillRaw(ctx: Ctx, r: Row, full: boolean): Promise<Row> {
  const lines = await ctx.db.all<Row>("SELECT * FROM bill_lines WHERE bill_id = ? ORDER BY sort, id", r.id);
  const payments = await ctx.db.all<Row>("SELECT * FROM outgoing_payments WHERE bill_id = ? ORDER BY id", r.id);
  const lineExtras = await loadExtras(ctx, "bill_lines", lines.map((l) => Number(l.id)));
  const name = await contactName(ctx, r.contact_id);
  const overdue = !!r.due_date && String(r.due_date) < today() && Number(r.amount_open) > 0;
  const items = lines.filter((l) => !lineExtras.get(Number(l.id))?.discount);
  const discounts = lines.filter((l) => lineExtras.get(Number(l.id))?.discount);
  const common = {
    id: uuidFor(TAG.bill, Number(r.id)),
    document_no: r.nr ?? "",
    title: r.title ?? null,
    status: billStatus(r, payments),
    firstname_suffix: name.first,
    lastname_company: name.last,
    created_at: isoDatetime(r.created_at),
    vendor_ref: r.vendor_nr ?? null,
    pending_amount: money(r.amount_open),
    currency_code: r.currency_code ?? "CHF",
    bill_date: date(r.date),
    due_date: date(r.due_date) ?? date(r.date),
    overdue,
    attachment_ids: attachmentIds(r.file_id),
  };
  if (!full) {
    return {
      ...common,
      vendor: [name.first, name.last].filter(Boolean).join(" ") || null,
      net: money(r.total_net),
      gross: money(r.total),
      booking_account_ids: [...new Set(items.map((l) => Number(l.account_id)).filter(Boolean))],
    };
  }
  const payment = payments.find((p) => p.status === "open" || p.status === "exported") ?? payments.at(-1);
  return {
    ...common,
    supplier_id: r.contact_id,
    amount_man: money(r.total),
    amount_calc: money(r.total),
    manual_amount: false,
    contact_partner_id: r.contact_id,
    exchange_rate: Number(r.exchange_rate ?? 1),
    base_currency_code: "CHF",
    item_net: r.vat_mode === "excl",
    split_into_line_items: true,
    purchase_order_id: null,
    base_currency_amount: money(Number(r.total) * Number(r.exchange_rate ?? 1)),
    qr_bill_information: r.qr_reference ?? null,
    address: await addressOf(ctx, r.contact_id),
    line_items: items.map((l, i) => ({
      id: uuidFor(TAG.bill_line, Number(l.id)),
      position: i,
      title: l.text ?? "",
      tax_id: l.tax_id ?? null,
      tax_calc: money(splitAmount(Number(l.amount), Number(l.tax_rate ?? 0), r.vat_mode === "excl" ? "excl" : "incl").vat),
      amount: money(l.amount),
      booking_account_id: l.account_id ?? null,
    })),
    discounts: discounts.map((l, i) => ({ id: uuidFor(TAG.discount, Number(l.id)), position: i, amount: -money(l.amount) })),
    ...(payment
      ? {
          payment: {
            type: payment.qr_reference ? "QR" : "IBAN",
            bank_account_id: payment.bank_account_id ?? null,
            fee: "NO_FEE",
            execution_date: date(payment.execution_date),
            exchange_rate: Number(r.exchange_rate ?? 1),
            amount: money(payment.amount),
            account_no: "",
            iban: payment.iban ?? "",
            name: payment.recipient_name ?? "",
            address: "",
            street: "",
            house_no: "",
            postcode: "",
            city: "",
            country_code: "CH",
            message: payment.message ?? "",
            booking_text: "",
            salary_payment: false,
            reference_no: payment.qr_reference ?? "",
            note: "",
          },
        }
      : {}),
    average_exchange_rate_enabled: false,
  };
}

export async function billInput(ctx: Ctx, b: Row): Promise<Row> {
  const out: Row = {};
  if (has(b, "supplier_id")) out.contact_id = b.supplier_id;
  if (has(b, "vendor_ref")) out.vendor_nr = b.vendor_ref || null;
  if (has(b, "document_no")) out.nr = b.document_no || undefined;
  if (has(b, "title")) out.title = b.title || null;
  if (has(b, "bill_date")) out.date = date(b.bill_date);
  if (has(b, "due_date")) out.due_date = date(b.due_date);
  if (has(b, "currency_code")) out.currency_code = String(b.currency_code).toUpperCase();
  if (has(b, "exchange_rate")) out.exchange_rate = Number(b.exchange_rate) || 1;
  if (has(b, "item_net")) out.vat_mode = bool(b.item_net) ? "excl" : "incl";
  if (has(b, "qr_bill_information")) out.qr_reference = b.qr_bill_information || null;
  if (has(b, "attachment_ids")) out.file_id = await firstAttachment(ctx, b.attachment_ids);
  const payment = b.payment as Row | undefined;
  if (payment) {
    if (payment.iban) out.iban = payment.iban;
    if (payment.reference_no) out.qr_reference = payment.reference_no;
    if (payment.message) out.payment_message = payment.message;
  }
  if (Array.isArray(b.line_items)) {
    const items = [...(b.line_items as Row[])].sort((x, y) => Number(x.position ?? 0) - Number(y.position ?? 0));
    const lines: Row[] = items.map((l) => ({
      ...(l.id ? { id: idFromUuid(String(l.id), TAG.bill_line) } : {}),
      text: l.title ?? null,
      amount: Number(l.amount),
      tax_id: l.tax_id ?? null,
      account_id: l.booking_account_id ?? null,
    }));
    const discounts = Array.isArray(b.discounts) ? (b.discounts as Row[]) : [];
    for (const d of discounts) {
      lines.push({
        ...(d.id ? { id: idFromUuid(String(d.id), TAG.discount) } : {}),
        text: "Discount",
        amount: -Math.abs(Number(d.amount)),
        tax_id: lines[0]?.tax_id ?? null,
        account_id: lines[0]?.account_id ?? null,
        _discount: true,
      });
    }
    out.lines = lines.map((l, i) => ({ ...l, sort: i }));
  }
  return out;
}

async function saveBillLineExtras(ctx: Ctx, billId: number, input: Row) {
  const lines = (input.lines as Row[] | undefined) ?? [];
  if (!lines.length) return;
  const stored = await ctx.db.all<Row>("SELECT id FROM bill_lines WHERE bill_id = ? ORDER BY sort, id", billId);
  for (const [i, l] of lines.entries()) if (stored[i]) await saveExtras(ctx, "bill_lines", Number(stored[i].id), { discount: !!l._discount }, ["discount"]);
}

async function bill(ctx: Ctx, raw: string): Promise<Row> {
  assertCan(ctx, "purchases", "read");
  const row = await ctx.db.first<Row>("SELECT * FROM bills WHERE id = ?", idFromUuid(raw, TAG.bill));
  if (!row) throw notFound("Bill");
  return row;
}

const BILL_COLUMNS: Columns = {
  id: "id",
  document_no: "nr",
  title: "title",
  bill_date: "date",
  due_date: "due_date",
  vendor_ref: "vendor_nr",
  currency_code: "currency_code",
  pending_amount: "amount_open",
  gross: "total",
  net: "total_net",
  created_at: "created_at",
};

async function scheduleFromBody(ctx: Ctx, billId: number, payment: Row | undefined) {
  if (!payment || String(payment.type ?? "").toUpperCase() === "MANUAL") return;
  const row = await getRecord(ctx, res("bills"), billId);
  if (!["booked", "partial"].includes(String(row.status))) return;
  await schedulePayment(ctx, row, {
    execution_date: date(payment.execution_date),
    amount: payment.amount !== undefined ? Math.round(Number(payment.amount) * 100) : null,
    bank_account_id: (payment.bank_account_id as number) ?? null,
  });
}

function billRoutes(): Route[] {
  return [
    route("GET", "/4.0/purchase/bills", async (c) => {
      assertCan(c.ctx, "purchases", "read");
      const p = pagePaging(c.query, 100);
      const where: string[] = [];
      const args: unknown[] = [];
      const q = (k: string) => c.query.get(k);
      const add = (sql: string, v: unknown) => {
        where.push(sql);
        args.push(v);
      };
      if (q("bill_date_start")) add("date >= ?", q("bill_date_start"));
      if (q("bill_date_end")) add("date <= ?", q("bill_date_end"));
      if (q("due_date_start")) add("due_date >= ?", q("due_date_start"));
      if (q("due_date_end")) add("due_date <= ?", q("due_date_end"));
      if (q("vendor_ref")) add("vendor_nr LIKE ?", `%${q("vendor_ref")}%`);
      if (q("title")) add("title LIKE ?", `%${q("title")}%`);
      if (q("document_no")) add("nr LIKE ?", `%${q("document_no")}%`);
      if (q("currency_code")) add("currency_code = ?", q("currency_code"));
      if (q("supplier_id")) add("contact_id = ?", Number(q("supplier_id")));
      if (q("pending_amount_min")) add("amount_open >= ?", Number(q("pending_amount_min")) * 100);
      if (q("pending_amount_max")) add("amount_open <= ?", Number(q("pending_amount_max")) * 100);
      if (q("gross_min")) add("total >= ?", Number(q("gross_min")) * 100);
      if (q("gross_max")) add("total <= ?", Number(q("gross_max")) * 100);
      if (q("net_min")) add("total_net >= ?", Number(q("net_min")) * 100);
      if (q("net_max")) add("total_net <= ?", Number(q("net_max")) * 100);
      if (q("vendor")) add("contact_id IN (SELECT id FROM contacts WHERE name_1 LIKE ? )", `%${q("vendor")}%`);
      if (q("search_term")) {
        where.push("(nr LIKE ? OR title LIKE ? OR vendor_nr LIKE ?)");
        args.push(...Array(3).fill(`%${q("search_term")}%`));
      }
      const statuses = q("status")?.split(",").map((s) => s.trim().toUpperCase()) ?? [];
      const sql = `FROM bills${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
      let rows = await c.ctx.db.all<Row>(`SELECT * ${sql} ORDER BY ${sortOrder(c.query, BILL_COLUMNS, "bill_date")}`, ...args);
      let wired = await Promise.all(rows.map((r) => readBill(c.ctx, r, false)));
      if (statuses.length) wired = wired.filter((b) => statuses.includes(String(b.status)));
      rows = [];
      return pageEnvelope(wired.slice(p.offset, p.offset + p.limit), wired.length, p);
    }),
    route("POST", "/4.0/purchase/bills", async (c) => {
      const b = bodyObject(c);
      for (const k of ["supplier_id", "bill_date", "due_date", "currency_code", "line_items"]) if (!has(b, k)) throw new AppError("validation", "The field {field} is required.", undefined, { field: k });
      const input = await billInput(c.ctx, b);
      const row = await createRecord(c.ctx, res("bills"), stripMarkers(input));
      await saveBillLineExtras(c.ctx, Number(row.id), input);
      // The payment is scheduled once the bill is booked.
      await saveExtras(c.ctx, "bills", Number(row.id), b, ["payment"]);
      return created(await readBill(c.ctx, await bill(c.ctx, String(row.id)), true));
    }),
    route("GET", "/4.0/purchase/bills/{id}", async (c) => readBill(c.ctx, await bill(c.ctx, c.params.id), true)),
    route("PUT", "/4.0/purchase/bills/{id}", async (c) => {
      const row = await bill(c.ctx, c.params.id);
      const input = await billInput(c.ctx, bodyObject(c));
      await updateRecord(c.ctx, res("bills"), Number(row.id), stripMarkers(input));
      await saveBillLineExtras(c.ctx, Number(row.id), input);
      await saveExtras(c.ctx, "bills", Number(row.id), bodyObject(c), ["payment"]);
      return readBill(c.ctx, await bill(c.ctx, String(row.id)), true);
    }),
    route("DELETE", "/4.0/purchase/bills/{id}", async (c) => {
      const row = await bill(c.ctx, c.params.id);
      await deleteRecord(c.ctx, res("bills"), Number(row.id));
      return noContent;
    }),
    route("PUT", "/4.0/purchase/bills/{id}/bookings/{status}", async (c) => {
      const row = await bill(c.ctx, c.params.id);
      const status = c.params.status.toUpperCase();
      if (status === "BOOKED" && row.status === "draft") {
        await bookBill(c.ctx, await getRecord(c.ctx, res("bills"), Number(row.id)));
        const payment = (await loadExtras(c.ctx, "bills", [Number(row.id)])).get(Number(row.id))?.payment as Row | undefined;
        await scheduleFromBody(c.ctx, Number(row.id), payment);
      }
      else if (status === "DRAFT" && row.status !== "draft") await revertBill(c.ctx, await getRecord(c.ctx, res("bills"), Number(row.id)));
      else if (status === "CANCELLED") await cancelBill(c.ctx, await getRecord(c.ctx, res("bills"), Number(row.id)));
      else if (!["BOOKED", "DRAFT"].includes(status)) throw new AppError("validation", "Unknown booking status.");
      return readBill(c.ctx, await bill(c.ctx, String(row.id)), true);
    }),
    route("POST", "/4.0/purchase/bills/{id}/actions", async (c) => {
      const row = await bill(c.ctx, c.params.id);
      if (bodyObject(c).action !== "DUPLICATE") throw new AppError("validation", "Unknown action.");
      const source = toApi(res("bills"), await getRecord(c.ctx, res("bills"), Number(row.id)));
      const lines = ((source.lines as Row[]) ?? []).map(({ id: _id, ...l }) => l);
      const copy = await createRecord(c.ctx, res("bills"), {
        contact_id: source.contact_id,
        title: source.title,
        vendor_nr: source.vendor_nr,
        date: today(),
        due_date: source.due_date,
        currency_code: source.currency_code,
        exchange_rate: source.exchange_rate,
        vat_mode: source.vat_mode,
        iban: source.iban,
        payment_message: source.payment_message,
        lines,
      });
      return readBill(c.ctx, await bill(c.ctx, String(copy.id)), true);
    }),
    route("GET", "/4.0/purchase/documentnumbers/bills", async (c) => {
      assertCan(c.ctx, "purchases", "read");
      const nr = c.query.get("document_no") ?? "";
      const taken = nr ? await c.ctx.db.value("SELECT id FROM bills WHERE nr = ?", nr) : null;
      return { valid: !!nr && !taken, next_available_no: await previewNumber(c.ctx, "bill") };
    }),

    // Outgoing payments of a bill.
    route("GET", "/4.0/purchase/outgoing-payments", async (c) => {
      const billId = c.query.get("bill_id");
      if (!billId) throw new AppError("validation", "The field {field} is required.", undefined, { field: "bill_id" });
      const row = await bill(c.ctx, billId);
      const p = pagePaging(c.query, 100);
      const rows = await c.ctx.db.all<Row>("SELECT * FROM outgoing_payments WHERE bill_id = ? ORDER BY id", row.id);
      const wired = await Promise.all(rows.map((x) => readOutgoing(c.ctx, x, row)));
      return pageEnvelope(wired.slice(p.offset, p.offset + p.limit), wired.length, p);
    }),
    route("POST", "/4.0/purchase/outgoing-payments", async (c) => {
      const b = bodyObject(c);
      const row = await bill(c.ctx, String(b.bill_id ?? ""));
      const full = await getRecord(c.ctx, res("bills"), Number(row.id));
      if (b.receiver_iban && !full.iban) await updateRecord(c.ctx, res("bills"), Number(row.id), { iban: b.receiver_iban }, { force: true });
      const id = await schedulePayment(c.ctx, await getRecord(c.ctx, res("bills"), Number(row.id)), {
        execution_date: date(b.execution_date),
        amount: b.amount !== undefined ? Math.round(Number(b.amount) * 100) : null,
        bank_account_id: (b.sender_bank_account_id as number) ?? null,
      });
      await saveExtras(c.ctx, "outgoing_payments", id, b, ["fee_type", "is_salary_payment", "note", "booking_text", "payment_type"]);
      return created(await readOutgoing(c.ctx, await outgoing(c.ctx, String(id)), row));
    }),
    route("PUT", "/4.0/purchase/outgoing-payments", async (c) => {
      const b = bodyObject(c);
      const row = await outgoing(c.ctx, String(b.payment_id ?? ""));
      const changes: Row = {};
      if (has(b, "execution_date")) changes.execution_date = date(b.execution_date);
      if (has(b, "amount")) changes.amount = Number(b.amount);
      if (has(b, "reference_no")) changes.qr_reference = b.reference_no || null;
      if (has(b, "message")) changes.message = b.message || null;
      if (has(b, "receiver_iban")) changes.iban = b.receiver_iban || null;
      if (has(b, "receiver_name")) changes.recipient_name = b.receiver_name || null;
      await updateRecord(c.ctx, res("outgoing_payments"), Number(row.id), changes);
      await saveExtras(c.ctx, "outgoing_payments", Number(row.id), b, ["fee_type", "is_salary_payment"]);
      return readOutgoing(c.ctx, await outgoing(c.ctx, String(row.id)), null);
    }),
    route("GET", "/4.0/purchase/outgoing-payments/{id}", async (c) => readOutgoing(c.ctx, await outgoing(c.ctx, c.params.id), null)),
    route("DELETE", "/4.0/purchase/outgoing-payments/{id}", async (c) => {
      const row = await outgoing(c.ctx, c.params.id);
      if (row.status === "paid") throw new AppError("conflict", "Paid payments cannot be deleted.");
      await deleteRecord(c.ctx, res("outgoing_payments"), Number(row.id));
      return noContent;
    }),
  ];
}

const stripMarkers = (input: Row): Row => (Array.isArray(input.lines) ? { ...input, lines: (input.lines as Row[]).map(({ _discount, ...l }) => l) } : input);

const OUTGOING_STATUS: Record<string, string> = { open: "PENDING", exported: "DOWNLOADED", paid: "PAID", cancelled: "ERROR" };

async function readOutgoingRaw(ctx: Ctx, r: Row, billRow: Row | null): Promise<Row> {
  const b = billRow ?? (await ctx.db.first<Row>("SELECT * FROM bills WHERE id = ?", r.bill_id));
  const bank = r.bank_account_id ? await ctx.db.first<Row>("SELECT * FROM bank_accounts WHERE id = ?", r.bank_account_id) : null;
  const extras = (await loadExtras(ctx, "outgoing_payments", [Number(r.id)])).get(Number(r.id)) ?? {};
  const contact = (await contactName(ctx, r.contact_id)).row;
  return {
    id: uuidFor(TAG.outgoing_payment, Number(r.id)),
    status: OUTGOING_STATUS[String(r.status)] ?? "PENDING",
    created_at: isoDatetime(r.created_at),
    bill_id: uuidFor(TAG.bill, Number(r.bill_id)),
    payment_type: (extras.payment_type as string) ?? (r.qr_reference ? "QR" : "IBAN"),
    execution_date: date(r.execution_date),
    amount: money(r.amount),
    currency_code: r.currency_code ?? "CHF",
    exchange_rate: Number(b?.exchange_rate ?? 1),
    note: (extras.note as string) ?? "",
    sender_bank_account_id: bank?.id ?? null,
    sender_iban: bank?.iban ?? "",
    sender_name: bank?.name ?? "",
    sender_street: "",
    sender_house_no: "",
    sender_city: "",
    sender_postcode: "",
    sender_country_code: "CH",
    sender_bc_no: "",
    sender_bank_no: "",
    sender_bank_name: bank?.bank_name ?? "",
    receiver_account_no: "",
    receiver_iban: r.iban ?? "",
    receiver_name: r.recipient_name ?? "",
    receiver_street: (contact?.street as string) ?? "",
    receiver_house_no: (contact?.house_number as string) ?? "",
    receiver_city: (contact?.city as string) ?? "",
    receiver_postcode: (contact?.postcode as string) ?? "",
    receiver_country_code: (contact?.country_code as string) ?? "CH",
    receiver_bc_no: "",
    receiver_bank_no: "",
    receiver_bank_name: "",
    fee_type: (extras.fee_type as string) ?? "NO_FEE",
    is_salary_payment: bool(extras.is_salary_payment),
    reference_no: r.qr_reference ?? "",
    message: r.message ?? "",
    booking_text: (extras.booking_text as string) ?? "",
    banking_payment_id: uuidFor(TAG.payment, Number(r.id)),
    banking_payment_entry_id: uuidFor(TAG.payment, Number(r.id)),
    transaction_id: null,
  };
}

// ------------------------------------------------------------------ expenses

async function readExpenseRaw(ctx: Ctx, r: Row, full: boolean): Promise<Row> {
  const name = await contactName(ctx, r.contact_id);
  const rate = r.tax_id ? Number((await ctx.db.value("SELECT rate FROM taxes WHERE id = ?", r.tax_id)) ?? 0) : 0;
  const split = splitAmount(Number(r.amount), rate, "incl");
  const common = {
    id: uuidFor(TAG.expense, Number(r.id)),
    document_no: r.nr ?? "",
    title: r.title ?? null,
    status: r.status === "booked" ? "DONE" : "DRAFT",
    firstname_suffix: name.first,
    lastname_company: name.last,
    created_at: isoDatetime(r.created_at),
    paid_on: date(r.date),
    booking_account_id: r.account_id ?? null,
    currency_code: r.currency_code ?? "CHF",
    project_id: r.project_id ? uuidFor(TAG.project, Number(r.project_id)) : null,
    transaction_id: null,
    invoice_id: null,
    attachment_ids: attachmentIds(r.file_id),
  };
  if (!full) return { ...common, vendor: [name.first, name.last].filter(Boolean).join(" ") || null, net: money(split.net), gross: money(r.amount), chargeable_contact_id: null };
  return {
    ...common,
    supplier_id: r.contact_id ?? null,
    bank_account_id: await bankAccountFor(ctx, r.payment_account_id),
    base_currency_code: "CHF",
    exchange_rate: 1,
    amount: money(r.amount),
    tax_man: money(split.vat),
    tax_calc: money(split.vat),
    tax_id: r.tax_id ?? null,
    base_currency_amount: money(r.amount),
    address: await addressOf(ctx, r.contact_id),
  };
}

export async function expenseInput(ctx: Ctx, b: Row): Promise<Row> {
  const out: Row = {};
  if (has(b, "paid_on")) out.date = date(b.paid_on);
  if (has(b, "currency_code")) out.currency_code = String(b.currency_code).toUpperCase();
  if (has(b, "supplier_id")) out.contact_id = b.supplier_id ?? null;
  if (has(b, "document_no")) out.nr = b.document_no || undefined;
  if (has(b, "title")) out.title = b.title || null;
  if (has(b, "booking_account_id")) out.account_id = b.booking_account_id ?? null;
  if (has(b, "amount")) out.amount = Number(b.amount);
  if (has(b, "tax_id")) out.tax_id = b.tax_id ?? null;
  if (has(b, "attachment_ids")) out.file_id = await firstAttachment(ctx, b.attachment_ids);
  if (has(b, "bank_account_id")) {
    out.payment_account_id = b.bank_account_id ? await ctx.db.value<number>("SELECT account_id FROM bank_accounts WHERE id = ?", b.bank_account_id) : null;
  }
  return out;
}

async function expense(ctx: Ctx, raw: string): Promise<Row> {
  assertCan(ctx, "purchases", "read");
  const row = await ctx.db.first<Row>("SELECT * FROM expenses WHERE id = ?", idFromUuid(raw, TAG.expense));
  if (!row) throw notFound("Expense");
  return row;
}

const EXPENSE_COLUMNS: Columns = { id: "id", document_no: "nr", title: "title", paid_on: "date", gross: "amount", created_at: "created_at", currency_code: "currency_code" };

function expenseRoutes(): Route[] {
  return [
    route("GET", "/4.0/expenses", async (c) => {
      assertCan(c.ctx, "purchases", "read");
      const p = pagePaging(c.query, 100);
      const where: string[] = [];
      const args: unknown[] = [];
      const q = (k: string) => c.query.get(k);
      const add = (sql: string, v: unknown) => {
        where.push(sql);
        args.push(v);
      };
      if (q("paid_on_start")) add("date >= ?", q("paid_on_start"));
      if (q("paid_on_end")) add("date <= ?", q("paid_on_end"));
      if (q("created_at_start")) add("created_at >= ?", q("created_at_start"));
      if (q("created_at_end")) add("created_at <= ?", `${q("created_at_end")} 23:59:59`);
      if (q("title")) add("title LIKE ?", `%${q("title")}%`);
      if (q("document_no")) add("nr LIKE ?", `%${q("document_no")}%`);
      if (q("currency_code")) add("currency_code = ?", q("currency_code"));
      if (q("supplier_id")) add("contact_id = ?", Number(q("supplier_id")));
      if (q("project_id")) add("project_id = ?", idFromUuid(q("project_id"), TAG.project));
      if (q("gross_min")) add("amount >= ?", Number(q("gross_min")) * 100);
      if (q("gross_max")) add("amount <= ?", Number(q("gross_max")) * 100);
      if (q("vendor")) add("contact_id IN (SELECT id FROM contacts WHERE name_1 LIKE ?)", `%${q("vendor")}%`);
      const sql = `FROM expenses${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
      const total = Number(await c.ctx.db.value(`SELECT count(*) ${sql}`, ...args)) || 0;
      const rows = await c.ctx.db.all<Row>(`SELECT * ${sql} ORDER BY ${sortOrder(c.query, EXPENSE_COLUMNS, "paid_on")} LIMIT ? OFFSET ?`, ...args, p.limit, p.offset);
      let wired = await Promise.all(rows.map((r) => readExpense(c.ctx, r, false)));
      if (q("net_min")) wired = wired.filter((e) => Number(e.net) >= Number(q("net_min")));
      if (q("net_max")) wired = wired.filter((e) => Number(e.net) <= Number(q("net_max")));
      return pageEnvelope(wired, total, p);
    }),
    route("POST", "/4.0/expenses", async (c) => {
      const b = bodyObject(c);
      for (const k of ["paid_on", "currency_code", "amount"]) if (!has(b, k)) throw new AppError("validation", "The field {field} is required.", undefined, { field: k });
      const input = await expenseInput(c.ctx, b);
      // The title is optional on the wire; Batzio names the expense after the supplier.
      if (!input.title) input.title = (await contactName(c.ctx, input.contact_id)).last ?? (b.address as Row | undefined)?.lastname_company ?? "Expense";
      const row = await createRecord(c.ctx, res("expenses"), input);
      return created(await readExpense(c.ctx, await expense(c.ctx, String(row.id)), true));
    }),
    route("GET", "/4.0/expenses/documentnumbers", async (c) => {
      assertCan(c.ctx, "purchases", "read");
      const nr = c.query.get("document_no") ?? "";
      const taken = nr ? await c.ctx.db.value("SELECT id FROM expenses WHERE nr = ?", nr) : null;
      return { valid: !!nr && !taken, next_available_no: await previewNumber(c.ctx, "expense") };
    }),
    route("GET", "/4.0/expenses/{id}", async (c) => readExpense(c.ctx, await expense(c.ctx, c.params.id), true)),
    route("PUT", "/4.0/expenses/{id}", async (c) => {
      const row = await expense(c.ctx, c.params.id);
      await updateRecord(c.ctx, res("expenses"), Number(row.id), await expenseInput(c.ctx, bodyObject(c)));
      return readExpense(c.ctx, await expense(c.ctx, String(row.id)), true);
    }),
    route("DELETE", "/4.0/expenses/{id}", async (c) => {
      const row = await expense(c.ctx, c.params.id);
      await deleteRecord(c.ctx, res("expenses"), Number(row.id));
      return noContent;
    }),
    route("PUT", "/4.0/expenses/{id}/bookings/{status}", async (c) => {
      const row = await expense(c.ctx, c.params.id);
      const status = c.params.status.toUpperCase();
      const full = await getRecord(c.ctx, res("expenses"), Number(row.id));
      if (status === "DONE" && row.status !== "booked") await bookExpense(c.ctx, full);
      else if (status === "DRAFT" && row.status === "booked") await revertExpense(c.ctx, full);
      else if (!["DONE", "DRAFT"].includes(status)) throw new AppError("validation", "Unknown booking status.");
      return readExpense(c.ctx, await expense(c.ctx, String(row.id)), true);
    }),
    route("POST", "/4.0/expenses/{id}/actions", async (c) => {
      const row = await expense(c.ctx, c.params.id);
      if (bodyObject(c).action !== "DUPLICATE") throw new AppError("validation", "Unknown action.");
      const s = toApi(res("expenses"), row);
      const copy = await createRecord(c.ctx, res("expenses"), {
        title: s.title,
        date: today(),
        amount: s.amount,
        currency_code: s.currency_code,
        tax_id: s.tax_id,
        account_id: s.account_id,
        payment_account_id: s.payment_account_id,
        contact_id: s.contact_id,
        project_id: s.project_id,
      });
      return readExpense(c.ctx, await expense(c.ctx, String(copy.id)), true);
    }),
  ];
}

// ------------------------------------------------------------------ payroll

const EMPLOYEE_EXTRAS = ["gender", "nationality", "stay_permit_category", "language", "marital_status", "canton", "municipality_id", "postbox", "locality", "complementary_line"];

async function readEmployeeRaw(ctx: Ctx, r: Row, detailed: boolean): Promise<Row> {
  const e = (await loadExtras(ctx, "employees", [Number(r.id)])).get(Number(r.id)) ?? {};
  const workload = Number(r.workload_percent ?? 100);
  const vacation = Math.round(Number(r.vacation_days ?? 25));
  const out: Row = {
    id: uuidFor(TAG.employee, Number(r.id)),
    first_name: r.firstname ?? "",
    last_name: r.lastname ?? "",
    date_of_birth: date(r.birthday),
    ahv_number: r.ahv_number ?? "",
    ...(e.gender ? { gender: e.gender } : {}),
    nationality: (e.nationality as string) ?? "CH",
    stay_permit_category: (e.stay_permit_category as string) ?? "",
    language: (e.language as string) ?? "de",
    marital_status: (e.marital_status as string) ?? "unknown",
    email: r.email ?? "",
    phone_number: r.phone ?? "",
    hours_per_week: Math.round(42 * workload) / 100,
    employment_level: workload,
    annual_vacation_days_total: vacation,
    address: {
      complementary_line: (e.complementary_line as string) ?? "",
      street: [r.street, r.house_number].filter(Boolean).join(" "),
      street_name: r.street ?? "",
      house_number: r.house_number ?? "",
      postbox: (e.postbox as string) ?? "",
      locality: (e.locality as string) ?? "",
      zip_code: r.postcode ?? "",
      city: r.city ?? "",
      country: r.country_code ?? "CH",
      canton: (e.canton as string) ?? "",
      municipality_id: (e.municipality_id as string) ?? "",
    },
    personal_number: r.nr ?? "",
    iban: r.iban ?? "",
  };
  if (detailed) {
    const year = new Date().getUTCFullYear();
    const used = Number(
      (await ctx.db.value(
        "SELECT coalesce(sum(days), 0) FROM absences WHERE employee_id = ? AND type = 'vacation' AND status != 'rejected' AND substr(start_date, 1, 4) = ?",
        r.id,
        String(year),
      )) ?? 0,
    );
    Object.assign(out, { annual_vacation_days_used: Math.round(used), annual_vacation_days_left: Math.round(vacation - used), effective_working_hours_per_week: Math.round((42 * workload) / 100) });
  }
  return out;
}

function employeeInput(b: Row): Row {
  const out: Row = {};
  const a = (b.address ?? {}) as Row;
  const map: [string, string][] = [
    ["first_name", "firstname"],
    ["last_name", "lastname"],
    ["email", "email"],
    ["phone_number", "phone"],
    ["ahv_number", "ahv_number"],
    ["iban", "iban"],
    ["personal_number", "nr"],
  ];
  for (const [w, o] of map) if (has(b, w)) out[o] = b[w] || null;
  if (has(b, "date_of_birth")) out.birthday = date(b.date_of_birth);
  if (has(b, "annual_vacation_days")) out.vacation_days = Number(b.annual_vacation_days);
  if (b.address) {
    if (has(a, "street_name") || has(a, "street")) out.street = a.street_name || String(a.street ?? "").replace(/\s+\S+$/, "") || null;
    if (has(a, "house_number")) out.house_number = a.house_number || null;
    if (has(a, "zip_code")) out.postcode = a.zip_code || null;
    if (has(a, "city")) out.city = a.city || null;
    if (has(a, "country")) out.country_code = String(a.country || "CH").slice(0, 2).toUpperCase();
  }
  return out;
}

async function saveEmployeeExtras(ctx: Ctx, id: number, b: Row) {
  const flat = { ...b, ...((b.address as Row | undefined) ?? {}) };
  await saveExtras(ctx, "employees", id, flat, EMPLOYEE_EXTRAS);
}

async function employee(ctx: Ctx, raw: string): Promise<Row> {
  assertCan(ctx, "payroll", "read");
  const row = await ctx.db.first<Row>("SELECT * FROM employees WHERE id = ?", idFromUuid(raw, TAG.employee));
  if (!row) throw notFound("Employee");
  return row;
}

const ABSENCE_TYPES = ["vacation", "sick", "accident", "military", "maternity", "paternity", "training", "other"];

async function readAbsenceRaw(ctx: Ctx, r: Row): Promise<Row> {
  const e = (await loadExtras(ctx, "absences", [Number(r.id)])).get(Number(r.id)) ?? {};
  return {
    id: uuidFor(TAG.absence, Number(r.id)),
    reason: (e.reason as string) ?? r.type,
    start_date: date(r.start_date),
    end_date: date(r.end_date),
    half_day: bool(e.half_day),
    continued_pay: Number(e.continued_pay ?? 100),
    disability: Number(e.disability ?? 0),
    paid_hours: Number(e.paid_hours ?? 0),
  };
}

function absenceInput(b: Row): Row {
  const out: Row = {};
  if (has(b, "reason")) {
    const reason = String(b.reason).toLowerCase();
    out.type = ABSENCE_TYPES.find((t) => reason.includes(t)) ?? (reason.includes("illness") || reason.includes("krank") ? "sick" : reason.includes("holiday") || reason.includes("ferien") ? "vacation" : "other");
  }
  if (has(b, "start_date")) out.start_date = date(b.start_date);
  if (has(b, "end_date")) out.end_date = date(b.end_date) ?? date(b.start_date);
  const start = out.start_date as string | undefined;
  const end = (out.end_date as string | undefined) ?? start;
  if (start && end) {
    const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1);
    out.days = bool(b.half_day) ? days - 0.5 : days;
  }
  out.status = "approved";
  return out;
}

async function absence(c: CompatCall): Promise<{ emp: Row; row: Row }> {
  const emp = await employee(c.ctx, c.params.employeeId);
  const row = await c.ctx.db.first<Row>("SELECT * FROM absences WHERE id = ? AND employee_id = ?", idFromUuid(c.params.absenceId, TAG.absence), emp.id);
  if (!row) throw notFound("Absence");
  return { emp, row };
}

async function payslipPdf(c: CompatCall) {
  const emp = await employee(c.ctx, c.params.employeeId);
  const slip = await c.ctx.db.first<Row>("SELECT * FROM payslips WHERE employee_id = ? AND year = ? AND month = ?", emp.id, Number(c.params.year), Number(c.params.month));
  if (!slip) throw notFound("Payslip");
  const full = await getRecord(c.ctx, res("employees"), Number(emp.id));
  return renderPayslipPdf(c.ctx, { employee: full, slip: await getRecord(c.ctx, res("payslips"), Number(slip.id)) });
}

function payrollRoutes(): Route[] {
  const ESR = "/4.0/payroll/employees";
  return [
    route("GET", ESR, async (c) => {
      assertCan(c.ctx, "payroll", "read");
      const rows = await c.ctx.db.all<Row>("SELECT * FROM employees ORDER BY lastname, firstname, id");
      return { data: await Promise.all(rows.map((r) => readEmployee(c.ctx, r, false))) };
    }),
    route("POST", ESR, async (c) => {
      const b = bodyObject(c);
      const input = employeeInput(b);
      if (!input.lastname) throw new AppError("validation", "The field {field} is required.", undefined, { field: "last_name" });
      const row = await createRecord(c.ctx, res("employees"), { firstname: "", ...input });
      await saveEmployeeExtras(c.ctx, Number(row.id), b);
      return created(await readEmployee(c.ctx, await employee(c.ctx, String(row.id)), true));
    }),
    route("GET", `${ESR}/{employeeId}`, async (c) => readEmployee(c.ctx, await employee(c.ctx, c.params.employeeId), true)),
    route("PATCH", `${ESR}/{employeeId}`, async (c) => {
      const row = await employee(c.ctx, c.params.employeeId);
      const b = bodyObject(c);
      const input = employeeInput(b);
      if (Object.keys(input).length) await updateRecord(c.ctx, res("employees"), Number(row.id), input);
      await saveEmployeeExtras(c.ctx, Number(row.id), b);
      return noContent;
    }),
    route("GET", `${ESR}/{employeeId}/absences`, async (c) => {
      const emp = await employee(c.ctx, c.params.employeeId);
      const year = c.query.get("businessYear") ?? String(new Date().getUTCFullYear());
      const rows = await c.ctx.db.all<Row>("SELECT * FROM absences WHERE employee_id = ? AND substr(start_date, 1, 4) = ? ORDER BY start_date, id", emp.id, year);
      return { data: await Promise.all(rows.map((r) => readAbsence(c.ctx, r))) };
    }),
    route("POST", `${ESR}/{employeeId}/absences`, async (c) => {
      const emp = await employee(c.ctx, c.params.employeeId);
      const b = bodyObject(c);
      if (!b.reason || !b.start_date) throw new AppError("validation", "Reason and start date are required.");
      const row = await createRecord(c.ctx, res("absences"), { ...absenceInput(b), employee_id: emp.id });
      await saveExtras(c.ctx, "absences", Number(row.id), b, ["reason", "half_day", "continued_pay", "disability", "paid_hours"]);
      return created(await readAbsence(c.ctx, row));
    }),
    route("GET", `${ESR}/{employeeId}/absences/{absenceId}`, async (c) => readAbsence(c.ctx, (await absence(c)).row)),
    route("PUT", `${ESR}/{employeeId}/absences/{absenceId}`, async (c) => {
      const { row } = await absence(c);
      const b = bodyObject(c);
      await updateRecord(c.ctx, res("absences"), Number(row.id), absenceInput(b));
      await saveExtras(c.ctx, "absences", Number(row.id), b, ["reason", "half_day", "continued_pay", "disability", "paid_hours"]);
      return noContent;
    }),
    route("DELETE", `${ESR}/{employeeId}/absences/{absenceId}`, async (c) => {
      const { row } = await absence(c);
      await deleteRecord(c.ctx, res("absences"), Number(row.id));
      return noContent;
    }),
    route("GET", `${ESR}/{employeeId}/paystub-pdf/{year}/{month}`, async (c) => {
      await payslipPdf(c);
      return { location: c.request.url.replace("/paystub-pdf/", "/paystub-pdf-download/") };
    }),
    route("GET", `${ESR}/{employeeId}/paystub-pdf-download/{year}/{month}`, async (c) => {
      const bytes = await payslipPdf(c);
      return raw(
        new Response(bytes as BodyInit, {
          headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="paystub-${c.params.year}-${String(c.params.month).padStart(2, "0")}.pdf"` },
        }),
      );
    }),
  ];
}

const readBankingPayment = async (...args: Parameters<typeof readBankingPaymentRaw>) => blanksToNull(await readBankingPaymentRaw(...args));
const readBill = async (...args: Parameters<typeof readBillRaw>) => blanksToNull(await readBillRaw(...args));
const readOutgoing = async (...args: Parameters<typeof readOutgoingRaw>) => blanksToNull(await readOutgoingRaw(...args));
const readExpense = async (...args: Parameters<typeof readExpenseRaw>) => blanksToNull(await readExpenseRaw(...args));
const readEmployee = async (...args: Parameters<typeof readEmployeeRaw>) => blanksToNull(await readEmployeeRaw(...args));
const readAbsence = async (...args: Parameters<typeof readAbsenceRaw>) => blanksToNull(await readAbsenceRaw(...args));

export function v4Routes(): Route[] {
  return [...bankingPaymentRoutes(), ...billRoutes(), ...expenseRoutes(), ...payrollRoutes()];
}
