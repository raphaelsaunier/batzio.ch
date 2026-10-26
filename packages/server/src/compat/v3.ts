import { AREAS, ROLE_PERMISSIONS } from "@batzio/core/permissions";
import { audit } from "../audit";
import { createRecord, deleteRecord, updateRecord } from "../crud";
import { assertCan, type Ctx } from "../ctx";
import { AppError, notFound } from "../errors";
import { fileResponse, storeFile } from "../files";
import { previewNumber } from "../numbering";
import { getResource } from "../resources/registry";
import type { Row } from "../resources/types";
import { getSettings } from "../settings";
import { loadExtras, saveExtras } from "./extras";
import { currencies, currencyCode, currencyId, languages, members, unitName, userNumber, userOf } from "./lookup";
import { createWire, crud, has, listWire, loadRow, pick, searchWire, selectRows, updateWire, wire, type Mapping } from "./table";
import { bodyObject, bool, created, raw, date, idFromUuid, isoDatetime, ok, orderBy, paging, pathId, route, searchWhere, uuidFor, TAG, type CompatCall, type Route } from "./wire";

// ------------------------------------------------------------------ accounting

const businessYearMapping: Mapping = {
  table: "business_years",
  area: "accounting",
  label: "Business year",
  columns: { id: "id", start: "start_date", end: "end_date", status: "status" },
  read: (r) => ({ id: r.id, start: date(r.start_date), end: date(r.end_date), status: r.status === "closed" ? "closed" : "open", closed_at: date(r.closed_at) }),
};

const calendarYearMapping: Mapping = {
  table: "calendar_years",
  area: "accounting",
  label: "Calendar year",
  rawColumns: ["year", "is_vat_subject", "is_annual_reporting", "vat_accounting_method", "vat_accounting_type", "default_tax_income_id", "default_tax_expense_id"],
  columns: { id: "id", start: { sql: "year || '-01-01'" }, end: { sql: "year || '-12-31'" }, vat_accounting_method: "vat_accounting_method", vat_accounting_type: "vat_accounting_type", is_vat_subject: "is_vat_subject" },
  read: (r) => ({
    id: r.id,
    start: `${r.year}-01-01`,
    end: `${r.year}-12-31`,
    is_vat_subject: bool(r.is_vat_subject),
    is_annual_reporting: bool(r.is_annual_reporting),
    created_at: date(r.created_at),
    updated_at: date(r.updated_at),
    vat_accounting_method: r.vat_accounting_method,
    vat_accounting_type: r.vat_accounting_type,
  }),
  write: (b) =>
    pick(b, {
      year: (v) => ({ year: Number(String(v).slice(0, 4)) }),
      is_vat_subject: (v) => ({ is_vat_subject: bool(v) ? 1 : 0 }),
      is_annual_reporting: (v) => ({ is_annual_reporting: bool(v) ? 1 : 0 }),
      vat_accounting_method: "vat_accounting_method",
      vat_accounting_type: "vat_accounting_type",
      default_tax_income_id: "default_tax_income_id",
      default_tax_expense_id: "default_tax_expense_id",
    }),
};

/** VAT period length → quarter / semester / annual. */
const periodType = (start: unknown, end: unknown) => {
  const months = (Date.parse(String(end)) - Date.parse(String(start))) / (30.4 * 86_400_000);
  return months > 7 ? "annual" : months > 4 ? "semester" : "quarter";
};

const vatPeriodMapping: Mapping = {
  table: "vat_periods",
  area: "accounting",
  label: "VAT period",
  columns: { id: "id", start: "start_date", end: "end_date" },
  read: (r) => ({
    id: r.id,
    start: date(r.start_date),
    end: date(r.end_date),
    type: periodType(r.start_date, r.end_date),
    status: r.status === "open" ? "open" : r.status === "submitted" ? "closed_with_message" : "closed",
    closed_at: date(r.submitted_at),
  }),
};

const REF_CLASS: Record<string, string> = {
  manual: "ManualEntry",
  invoice: "KbInvoice",
  credit_note: "KbCreditVoucher",
  payment: "KbInvoicePayment",
  bill: "KbBill",
  bill_payment: "KbBillPayment",
  expense: "KbExpense",
  bank: "BankTransaction",
  payroll: "Payroll",
  vat_settlement: "VatSettlement",
  opening: "OpeningEntry",
  closing: "ClosingEntry",
  reversal: "ManualEntry",
};

async function journal(c: CompatCall) {
  assertCan(c.ctx, "accounting", "read");
  const { limit, offset } = paging(c.query);
  const where: string[] = [];
  const args: unknown[] = [];
  if (c.query.get("from")) {
    where.push("e.date >= ?");
    args.push(c.query.get("from"));
  }
  if (c.query.get("to")) {
    where.push("e.date <= ?");
    args.push(c.query.get("to"));
  }
  if (c.query.get("account_uuid")) {
    const id = idFromUuid(c.query.get("account_uuid"), TAG.account);
    where.push("(l.debit_account_id = ? OR l.credit_account_id = ?)");
    args.push(id, id);
  }
  const rows = await c.ctx.db.all<Row>(
    `SELECT l.*, e.date, e.type, e.currency_code, e.exchange_rate, e.description AS entry_description
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY e.date, l.entry_id, l.sort, l.id LIMIT ? OFFSET ?`,
    ...args,
    limit,
    offset,
  );
  const base = await currencyId(c.ctx, "CHF");
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      ref_id: r.entry_id,
      ref_uuid: uuidFor(TAG.journal, Number(r.entry_id)),
      ref_class: REF_CLASS[String(r.type)] ?? "ManualEntry",
      date: date(r.date),
      debit_account_id: r.debit_account_id,
      credit_account_id: r.credit_account_id,
      description: r.description ?? r.entry_description ?? "",
      amount: Number(r.amount) / 100,
      currency_id: await currencyId(c.ctx, r.currency_code ?? "CHF"),
      currency_factor: Number(r.exchange_rate ?? 1),
      base_currency_id: base,
      base_currency_amount: (Number(r.amount) / 100) * Number(r.exchange_rate ?? 1),
    })),
  );
}

const MANUAL_TYPES = ["manual_single_entry", "manual_compound_entry", "manual_group_entry"];

async function readManualEntry(ctx: Ctx, r: Row): Promise<Row> {
  const lines = await ctx.db.all<Row>("SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort, id", r.id);
  const extras = (await loadExtras(ctx, "journal_entries", [Number(r.id)])).get(Number(r.id));
  const lineExtras = await loadExtras(ctx, "journal_lines", lines.map((l) => Number(l.id)));
  const creator = userOf(ctx, null);
  const currency = await currencyId(ctx, r.currency_code ?? "CHF");
  const base = await currencyId(ctx, "CHF");
  const type = (extras?.type as string) ?? (lines.length > 1 ? "manual_compound_entry" : "manual_single_entry");
  const out: Row = {
    id: r.id,
    type,
    date: date(r.date),
    reference_nr: r.ref_nr ?? "",
    created_by_user_id: creator,
    edited_by_user_id: creator,
    entries: lines.map((l) => ({
      id: l.id,
      date: date(r.date),
      debit_account_id: l.debit_account_id,
      credit_account_id: l.credit_account_id,
      tax_id: l.tax_id ?? null,
      tax_account_id: (lineExtras.get(Number(l.id))?.tax_account_id as number | undefined) ?? null,
      description: l.description ?? "",
      amount: Number(l.amount) / 100,
      currency_id: currency,
      base_currency_id: base,
      currency_factor: Number(r.exchange_rate ?? 1),
      base_currency_amount: (Number(l.amount) / 100) * Number(r.exchange_rate ?? 1),
      created_by_user_id: creator,
      edited_by_user_id: creator,
    })),
    is_locked: bool(r.is_locked) || r.type !== "manual",
  };
  if (out.is_locked) out.locked_info = r.type !== "manual" ? "is_generated" : "locked_business_year";
  return out;
}

export async function manualEntryInput(ctx: Ctx, b: Row, existing: Row | null) {
  const entries = Array.isArray(b.entries) ? (b.entries as Row[]) : [];
  if (!existing && !entries.length) throw new AppError("validation", "A manual entry needs at least one line.");
  const out: Row = {};
  if (has(b, "date")) out.date = date(b.date);
  if (has(b, "reference_nr")) out.ref_nr = b.reference_nr || null;
  if (entries.length) {
    out.lines = entries.map((e, i) => ({
      ...(e.id ? { id: Number(e.id) } : {}),
      sort: i,
      debit_account_id: Number(e.debit_account_id),
      credit_account_id: Number(e.credit_account_id),
      amount: Number(e.amount),
      tax_id: e.tax_id ?? null,
      description: e.description ?? null,
    }));
    out.description = String(entries.find((e) => e.description)?.description ?? existing?.description ?? "Manual entry");
    const currency = entries[0].currency_id ? await currencyCode(ctx, entries[0].currency_id) : null;
    if (currency) out.currency_code = currency;
  }
  return out;
}

async function saveLineExtras(ctx: Ctx, entryId: number, entries: Row[]) {
  const lines = await ctx.db.all<Row>("SELECT id FROM journal_lines WHERE entry_id = ? ORDER BY sort, id", entryId);
  for (const [i, e] of entries.entries()) if (lines[i] && has(e, "tax_account_id")) await saveExtras(ctx, "journal_lines", Number(lines[i].id), e, ["tax_account_id"]);
}

async function manualEntry(ctx: Ctx, id: number): Promise<Row> {
  assertCan(ctx, "accounting", "read");
  const row = await ctx.db.first<Row>("SELECT * FROM journal_entries WHERE id = ?", id);
  if (!row) throw notFound("Manual entry");
  return row;
}

const readFile3 = async (ctx: Ctx, r: Row): Promise<Row> => {
  const extras = (await loadExtras(ctx, "files", [Number(r.id)])).get(Number(r.id));
  const name = String(r.name ?? "");
  return {
    id: r.id,
    uuid: uuidFor(TAG.file, Number(r.id)),
    name: name.replace(/\.[^.]+$/, ""),
    size_in_bytes: Number(r.size ?? 0),
    extension: name.includes(".") ? name.split(".").pop() : "",
    mime_type: r.mime_type ?? "application/octet-stream",
    uploader_email: null,
    user_id: userOf(ctx, null),
    is_archived: bool(extras?.is_archived),
    source_id: 1,
    source_type: (extras?.source_type as string | undefined) ?? "web",
    is_referenced: !!r.ref_type,
    created_at: isoDatetime(r.created_at),
  };
};

async function uploads(c: CompatCall, field: string, ref?: { type: string; id: number }): Promise<Row[]> {
  assertCan(c.ctx, "files", "write");
  const form = await c.request.formData().catch(() => null);
  if (!form) throw new AppError("validation", "Send the file as multipart/form-data.");
  const files = form.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) throw new AppError("validation", "No file in the field {field}.", undefined, { field });
  const out: Row[] = [];
  for (const file of files) {
    const row = await storeFile(c.ctx, { name: file.name, type: file.type, bytes: await file.arrayBuffer() }, ref ? { type: ref.type, id: ref.id } : undefined);
    out.push(await readFile3(c.ctx, row as unknown as Row));
  }
  return out;
}

function entryFileRoutes(base: string, ref: (c: CompatCall) => Promise<{ type: string; id: number }>): Route[] {
  const one = async (c: CompatCall) => {
    const r = await ref(c);
    const row = await c.ctx.db.first<Row>("SELECT * FROM files WHERE id = ? AND ref_type = ? AND ref_id = ?", pathId(c, "file_id"), r.type, r.id);
    if (!row) throw notFound("File");
    return row;
  };
  return [
    route("GET", base, async (c) => {
      const r = await ref(c);
      const { limit, offset } = paging(c.query);
      const rows = await c.ctx.db.all<Row>("SELECT * FROM files WHERE ref_type = ? AND ref_id = ? ORDER BY id LIMIT ? OFFSET ?", r.type, r.id, limit, offset);
      return Promise.all(rows.map((x) => readFile3(c.ctx, x)));
    }),
    route("POST", base, async (c) => created(await uploads(c, "fileName", await ref(c)))),
    route("GET", `${base}/{file_id}`, async (c) => {
      const row = await one(c);
      const res = await fileResponse(c.ctx, Number(row.id));
      const bytes = new Uint8Array(await res.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { ...(await readFile3(c.ctx, row)), data: btoa(s) };
    }),
    route("DELETE", `${base}/{file_id}`, async (c) => {
      const row = await one(c);
      await deleteRecord(c.ctx, getResource("files")!, Number(row.id));
      return ok;
    }),
  ];
}

function accountingRoutes(): Route[] {
  const entries = getResource("journal_entries")!;
  const entryRef = async (c: CompatCall) => ({ type: "journal_entries", id: Number((await manualEntry(c.ctx, pathId(c, "manual_entry_id"))).id) });
  const lineRef = async (c: CompatCall) => {
    const entry = await manualEntry(c.ctx, pathId(c, "manual_entry_id"));
    const line = await c.ctx.db.first<Row>("SELECT id FROM journal_lines WHERE id = ? AND entry_id = ?", pathId(c, "entry_id"), entry.id);
    if (!line) throw notFound("Entry");
    return { type: "journal_lines", id: Number(line.id) };
  };
  return [
    route("GET", "/3.0/accounting/business_years", (c) => listWire(c, businessYearMapping)),
    route("GET", "/3.0/accounting/business_years/{business_year_id}", async (c) => wire(c.ctx, businessYearMapping, await loadRow(c.ctx, businessYearMapping, pathId(c, "business_year_id")))),
    route("GET", "/3.0/accounting/calendar_years", (c) => listWire(c, calendarYearMapping)),
    route("POST", "/3.0/accounting/calendar_years", async (c) => {
      const b = bodyObject(c);
      if (!b.year) throw new AppError("validation", "Enter the year.");
      return created([await createWire(c.ctx, calendarYearMapping, b)]);
    }),
    route("POST", "/3.0/accounting/calendar_years/search", (c) => searchWire(c, calendarYearMapping)),
    route("GET", "/3.0/accounting/calendar_years/{calendar_year_id}", async (c) => wire(c.ctx, calendarYearMapping, await loadRow(c.ctx, calendarYearMapping, pathId(c, "calendar_year_id")))),
    route("GET", "/3.0/accounting/journal", journal),
    route("GET", "/3.0/accounting/vat_periods", (c) => listWire(c, vatPeriodMapping)),
    route("GET", "/3.0/accounting/vat_periods/{vat_period_id}", async (c) => wire(c.ctx, vatPeriodMapping, await loadRow(c.ctx, vatPeriodMapping, pathId(c, "vat_period_id")))),
    route("GET", "/3.0/accounting/manual_entries", async (c) => {
      assertCan(c.ctx, "accounting", "read");
      const { limit, offset } = paging(c.query);
      const rows = await c.ctx.db.all<Row>("SELECT * FROM journal_entries WHERE type IN ('manual', 'reversal', 'opening') ORDER BY date, id LIMIT ? OFFSET ?", limit, offset);
      return Promise.all(rows.map((r) => readManualEntry(c.ctx, r)));
    }),
    route("POST", "/3.0/accounting/manual_entries", async (c) => {
      const b = bodyObject(c);
      if (b.type && !MANUAL_TYPES.includes(String(b.type))) throw new AppError("validation", "Unknown entry type.");
      const row = await createRecord(c.ctx, entries, await manualEntryInput(c.ctx, b, null));
      await saveExtras(c.ctx, "journal_entries", Number(row.id), b, ["type"]);
      await saveLineExtras(c.ctx, Number(row.id), (b.entries as Row[]) ?? []);
      return created(await readManualEntry(c.ctx, await manualEntry(c.ctx, Number(row.id))));
    }),
    route("PUT", "/3.0/accounting/manual_entries/{manual_entry_id}", async (c) => {
      const existing = await manualEntry(c.ctx, pathId(c, "manual_entry_id"));
      const b = bodyObject(c);
      await updateRecord(c.ctx, entries, Number(existing.id), await manualEntryInput(c.ctx, b, existing));
      await saveExtras(c.ctx, "journal_entries", Number(existing.id), b, ["type"]);
      await saveLineExtras(c.ctx, Number(existing.id), (b.entries as Row[]) ?? []);
      return readManualEntry(c.ctx, await manualEntry(c.ctx, Number(existing.id)));
    }),
    route("DELETE", "/3.0/accounting/manual_entries/{manual_entry_id}", async (c) => {
      const existing = await manualEntry(c.ctx, pathId(c, "manual_entry_id"));
      await deleteRecord(c.ctx, entries, Number(existing.id));
      return ok;
    }),
    route("GET", "/3.0/accounting/manual_entries/next_ref_nr", async (c) => {
      assertCan(c.ctx, "accounting", "read");
      return { next_ref_nr: await previewNumber(c.ctx, "journal") };
    }),
    ...entryFileRoutes("/3.0/accounting/manual_entries/{manual_entry_id}/entries/{entry_id}/files", lineRef),
    ...entryFileRoutes("/3.0/accounting/manual_entries/{manual_entry_id}/files", entryRef),
  ];
}

// ------------------------------------------------------------------ banking, currencies, taxes

const bankAccountMapping: Mapping = {
  table: "bank_accounts",
  area: "banking",
  label: "Bank account",
  columns: { id: "id", name: "name", iban_nr: "iban" },
  read: async (r, ctx) => {
    const company = await getSettings(ctx, "company");
    return {
      id: r.id,
      uuid: uuidFor(TAG.bank_account, Number(r.id)),
      name: r.name,
      owner: company.name || ctx.tenant.name,
      owner_address: company.street ?? "",
      owner_house_number: company.house_number ?? "",
      owner_zip: company.postcode ?? "",
      owner_city: company.city ?? "",
      owner_country_code: company.country_code ?? "CH",
      bc_nr: "",
      bank_name: r.bank_name ?? "",
      bank_nr: "",
      bank_account_nr: "",
      iban_nr: r.iban ?? "",
      currency_id: await currencyId(ctx, r.currency_code),
      account_id: r.account_id ?? null,
      remarks: "",
      qr_invoice_iban: r.qr_iban ?? "",
      invoice_mode: r.qr_iban ? "qr_iban" : r.iban ? "iban_with_creditor_reference" : "none",
      is_esr: false,
      esr_besr_id: r.qr_reference_prefix ?? "",
      esr_post_account_nr: "",
      esr_payment_for_text: "",
      esr_in_favour_of_text: "",
      type: "bank",
    };
  },
};

const currencyWire = (r: Row) => ({ id: r.id, name: r.code, round_factor: Number(r.rounding ?? 0.01) });

async function currencyList(c: CompatCall) {
  assertCan(c.ctx, "accounting", "read");
  const { limit, offset } = paging(c.query, 2000, 2000);
  const rows = await c.ctx.db.all<Row>("SELECT * FROM currencies ORDER BY id LIMIT ? OFFSET ?", limit, offset);
  const embed = (c.query.get("embed") ?? "").includes("exchange_rate");
  return Promise.all(
    rows.map(async (r) => {
      const base = currencyWire(r);
      if (!embed) return base;
      const rate = await latestRate(c.ctx, String(r.code), c.query.get("date"));
      return {
        ...base,
        exchange_rate: rate.rate,
        exchange_rate_id: rate.id ?? 0,
        ratio: 1,
        exchange_rate_to_ratio: rate.rate,
        source: "custom",
        source_reason: "source_custom",
        exchange_rate_date: rate.date,
      };
    }),
  );
}

async function latestRate(ctx: Ctx, code: string, at: string | null) {
  const row = await ctx.db.first<Row>(
    "SELECT * FROM exchange_rates WHERE currency_code = ? AND date <= ? ORDER BY date DESC, id DESC LIMIT 1",
    code,
    at ?? "9999-12-31",
  );
  const fallback = await ctx.db.first<Row>("SELECT rate, is_base FROM currencies WHERE code = ?", code);
  return {
    id: row ? Number(row.id) : null,
    rate: row ? Number(row.rate) : bool(fallback?.is_base) ? 1 : Number(fallback?.rate ?? 1),
    date: row ? date(row.date) : (at ?? new Date().toISOString().slice(0, 10)),
  };
}

const ISO_CURRENCIES = ["CHF", "EUR", "USD", "GBP", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "CNY", "HKD", "SGD", "NZD", "ZAR", "TRY", "BRL", "MXN", "INR"];

function currencyRoutes(): Route[] {
  const res = getResource("currencies")!;
  const one = async (c: CompatCall) => {
    assertCan(c.ctx, "accounting", "read");
    const row = await c.ctx.db.first<Row>("SELECT * FROM currencies WHERE id = ?", pathId(c, "currency_id"));
    if (!row) throw notFound("Currency");
    return row;
  };
  return [
    route("GET", "/3.0/currencies", currencyList),
    route("POST", "/3.0/currencies", async (c) => {
      const b = bodyObject(c);
      const code = String(b.name ?? "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) throw new AppError("validation", "Use a three-letter currency code.");
      const row = await createRecord(c.ctx, res, { code, name: code, rounding: b.round_factor ?? 0.01 });
      return created(currencyWire(row));
    }),
    route("GET", "/3.0/currencies/codes", async () => [ISO_CURRENCIES]),
    route("GET", "/3.0/currencies/{currency_id}", async (c) => currencyWire(await one(c))),
    route("DELETE", "/3.0/currencies/{currency_id}", async (c) => {
      const row = await one(c);
      await deleteRecord(c.ctx, res, Number(row.id));
      return ok;
    }),
    route("PATCH", "/3.0/currencies/{currency_id}", async (c) => {
      const row = await one(c);
      const b = bodyObject(c);
      const updated = has(b, "round_factor") ? await updateRecord(c.ctx, res, Number(row.id), { rounding: Number(b.round_factor) }) : row;
      return created(currencyWire(updated));
    }),
    route("GET", "/3.0/currencies/{currency_id}/exchange_rates", async (c) => {
      const base = await one(c);
      const all = await c.ctx.db.all<Row>("SELECT * FROM currencies WHERE id != ? ORDER BY id", base.id);
      const baseRate = await latestRate(c.ctx, String(base.code), c.query.get("date"));
      return Promise.all(
        all.map(async (other) => {
          const rate = await latestRate(c.ctx, String(other.code), c.query.get("date"));
          const factor = rate.rate ? baseRate.rate / rate.rate : 0;
          return {
            factor_nr: Number(factor.toFixed(6)),
            exchange_currency: currencyWire(other),
            ratio: 1,
            exchange_rate_to_ratio: Number(factor.toFixed(6)),
            source: "custom",
            source_reason: "source_custom",
            exchange_rate_date: rate.date,
          };
        }),
      );
    }),
  ];
}

const TAX_TYPE = (r: Row) =>
  r.type === "sales"
    ? r.category === "exempt" || r.category === "zero"
      ? "not_taxable_turnover"
      : "sales_tax"
    : r.category === "investment"
      ? "pre_tax_investment"
      : "pre_tax_material";

const taxMapping: Mapping = {
  table: "taxes",
  area: "accounting",
  resource: "taxes",
  label: "Tax",
  columns: { id: "id", code: "code", name: "name", value: "rate" },
  read: (r) => {
    const from = r.valid_from ? new Date(String(r.valid_from)) : null;
    const to = r.valid_to ? new Date(String(r.valid_to)) : null;
    return {
      id: r.id,
      uuid: uuidFor(TAG.tax, Number(r.id)),
      name: r.code,
      code: r.code,
      digit: r.vat_form_digit ?? null,
      type: TAX_TYPE(r),
      account_id: r.account_id ?? null,
      tax_settlement_type: "agreed",
      value: Number(r.rate),
      net_tax_value: null,
      start_year: from ? from.getUTCFullYear() : null,
      end_year: to ? to.getUTCFullYear() : null,
      is_active: bool(r.is_active),
      display_name: r.name,
      start_month: from ? from.getUTCMonth() + 1 : null,
      end_month: to ? to.getUTCMonth() + 1 : null,
    };
  },
};

async function taxList(c: CompatCall) {
  const where: string[] = [];
  const args: unknown[] = [];
  const scope = c.query.get("scope");
  if (scope === "active") where.push("is_active = 1");
  if (scope === "inactive") where.push("is_active = 0");
  const at = c.query.get("date");
  if (at) {
    where.push("(valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)");
    args.push(at, at);
  }
  const types = (c.query.get("types") ?? "").split(",").filter(Boolean);
  if (types.length) {
    const sales = types.some((t) => t.includes("sales") || t === "not_taxable_turnover");
    const purchase = types.some((t) => t.startsWith("pre_"));
    if (sales !== purchase) where.push(sales ? "type = 'sales'" : "type = 'purchase'");
  }
  return listWire(c, taxMapping, { where, args });
}

// ------------------------------------------------------------------ users, permissions, templates, files

function userWire(m: { user_id: string; name: string; email: string; role: string }) {
  const [firstname, ...rest] = String(m.name ?? "").trim().split(/\s+/);
  return {
    id: userNumber(m.user_id),
    firstname: firstname || null,
    lastname: rest.join(" ") || null,
    email: m.email,
    is_superadmin: m.role === "owner",
    is_accountant: m.role === "accountant",
  };
}

const fictionalMapping: Mapping = {
  table: "fictional_users",
  area: "settings",
  resource: "fictional_users",
  label: "Fictional user",
  columns: { id: "id", firstname: "firstname", lastname: "lastname", email: "email" },
  extras: ["salutation_type", "title_id"],
  read: (r) => ({ id: r.id, salutation_type: "male", firstname: r.firstname ?? "", lastname: r.lastname ?? "", email: r.email ?? "", title_id: null }),
  write: (b) => pick(b, { firstname: "firstname", lastname: "lastname", email: "email" }),
};

const fileMapping: Mapping = {
  table: "files",
  area: "files",
  label: "File",
  columns: { id: "id", name: "name", mime_type: "mime_type", size_in_bytes: "size", created_at: "created_at" },
  read: (r, ctx) => readFile3(ctx, r),
};

async function fileList(c: CompatCall, searchBody?: unknown) {
  assertCan(c.ctx, "files", "read");
  const { limit, offset } = paging(c.query, 2000, 100);
  const s = searchBody !== undefined ? searchWhere(searchBody, fileMapping.columns) : { sql: [], args: [] };
  const rows = await selectRows(c.ctx, fileMapping, { where: s.sql, args: s.args, order: orderBy(c.query.get("order_by"), fileMapping.columns, "id") });
  const state = c.query.get("archived_state") ?? "all";
  const wired = await Promise.all(rows.map((r) => readFile3(c.ctx, r)));
  return wired.filter((f) => state === "all" || (state === "archived") === f.is_archived).slice(offset, offset + limit);
}

async function fileUsage(ctx: Ctx, r: Row) {
  if (!r.ref_type || !r.ref_id) throw notFound("File usage");
  const ref = await ctx.db.first<Row>(`SELECT * FROM ${String(r.ref_type).replace(/\W/g, "")} WHERE id = ?`, r.ref_id).catch(() => null);
  const classes: Record<string, string> = { documents: "KbInvoice", bills: "KbBill", expenses: "KbExpense", journal_entries: "ManualEntry", contacts: "Contact" };
  return {
    id: Number(r.ref_id),
    ref_class: classes[String(r.ref_type)] ?? String(r.ref_type),
    title: String(ref?.title ?? ref?.name ?? ref?.description ?? ""),
    document_nr: String(ref?.nr ?? ref?.ref_nr ?? ""),
  };
}

function fileRoutes(): Route[] {
  const one = async (c: CompatCall) => {
    assertCan(c.ctx, "files", "read");
    return loadRow(c.ctx, fileMapping, pathId(c, "file_id"));
  };
  return [
    route("GET", "/3.0/files", (c) => fileList(c)),
    route("POST", "/3.0/files", async (c) => uploads(c, "file")),
    route("POST", "/3.0/files/search", (c) => fileList(c, c.body ?? [])),
    route("GET", "/3.0/files/{file_id}", async (c) => readFile3(c.ctx, await one(c))),
    route("DELETE", "/3.0/files/{file_id}", async (c) => {
      const row = await one(c);
      await deleteRecord(c.ctx, getResource("files")!, Number(row.id));
      return ok;
    }),
    route("PATCH", "/3.0/files/{file_id}", async (c) => {
      const row = await one(c);
      assertCan(c.ctx, "files", "write");
      const b = bodyObject(c);
      if (has(b, "name") && b.name) {
        const ext = String(row.name).includes(".") ? `.${String(row.name).split(".").pop()}` : "";
        await c.ctx.db.run("UPDATE files SET name = ?, updated_at = datetime('now') WHERE id = ?", `${String(b.name).replace(/\.[^.]+$/, "")}${ext}`, row.id);
        await audit(c.ctx, { action: "update", resource: "files", resourceId: Number(row.id), summary: `Renamed file to ${b.name}` });
      }
      await saveExtras(c.ctx, "files", Number(row.id), b, ["is_archived", "source_type"]);
      return readFile3(c.ctx, await one(c));
    }),
    route("GET", "/3.0/files/{file_id}/download", async (c) => raw(await fileResponse(c.ctx, Number((await one(c)).id), false))),
    route("GET", "/3.0/files/{file_id}/preview", async (c) => raw(await fileResponse(c.ctx, Number((await one(c)).id), true))),
    route("GET", "/3.0/files/{file_id}/usage", async (c) => fileUsage(c.ctx, await one(c))),
  ];
}

// ------------------------------------------------------------------ purchase orders

const PO_STATUS: Record<string, number> = { draft: 22, sent: 23, confirmed: 24, received: 25, cancelled: 26 };

async function readPurchaseOrder(ctx: Ctx, r: Row): Promise<Row> {
  const lang = (await languages(ctx)).byCode.get(String(r.language ?? "de").toUpperCase());
  const cur = (await currencies(ctx)).byCode.get(String(r.currency_code ?? "CHF").toUpperCase());
  return {
    id: r.id,
    document_nr: r.nr ?? "",
    kb_payment_template_id: null,
    payment_type_id: 1,
    title: r.title ?? null,
    contact_id: r.contact_id,
    contact_sub_id: r.contact_person_id ?? null,
    template_slug: null,
    user_id: userOf(ctx, r.responsible_user_id),
    project_id: r.project_id ?? null,
    logopaper_id: 1,
    language: { id: lang?.id ?? null, name: lang?.name ?? null, decimalpoint: ".", thousandsseparator: "’", iso_639_1: String(r.language ?? "de"), date_format: "d.m.Y" },
    language_id: lang?.id ?? null,
    bank_account_id: r.bank_account_id ?? null,
    currency: cur ? { id: cur.id, name: cur.code, round_factor: Number(cur.rounding ?? 0.01) } : null,
    currency_id: cur?.id ?? null,
    header: r.header ?? null,
    footer: r.footer ?? null,
    total_rounding_difference: Number(r.rounding ?? 0) / 100,
    mwst_type: r.vat_mode === "incl" ? "included" : r.vat_mode === "none" ? "exempt" : "excluded",
    mwst_is_net: r.vat_mode !== "incl",
    is_compact_view: false,
    show_position_taxes: false,
    salesman_user_id: null,
    is_valid_from: date(r.date),
    is_valid_to: date(r.due_date),
    delivery_address_type: r.delivery_address ? "manual" : "contact_address",
    contact_address_manual: r.address ?? "",
    delivery_address_manual: r.delivery_address ?? "",
    nb_decimals_amount: 2,
    nb_decimals_price: 2,
    kb_item_status_id: PO_STATUS[String(r.status)] ?? 22,
    terms_of_payment_text: null,
    reference: r.reference ?? null,
    api_reference: null,
    mail: null,
    viewed_by_client_at: null,
    is_valid_until: date(r.due_date),
    created_at: date(r.created_at),
    updated_at: date(r.updated_at),
    custom_translations: {},
    date_format: "d.m.Y",
  };
}

/** The grouped v3 position lists → Batzio positions. */
async function v3Positions(ctx: Ctx, groups: Row): Promise<Row[]> {
  const out: Row[] = [];
  const add = async (p: Row, optional: boolean) => {
    const type = String(p.type ?? "custom");
    if (type === "group") {
      out.push({ type: "text", text: p.text ?? "", is_optional: optional });
      for (const child of (p.positions as Row[]) ?? []) await add(child, optional);
      return;
    }
    if (type === "article" || type === "custom") {
      const item = type === "article" && p.article_id ? await ctx.db.first<Row>("SELECT * FROM items WHERE id = ?", p.article_id) : null;
      out.push({
        type: type === "article" ? "item" : "custom",
        item_id: item?.id ?? null,
        code: item?.nr ?? null,
        text: p.text ?? item?.name ?? "",
        quantity: Number(p.amount ?? 1),
        unit_name: p.unit_id ? await unitName(ctx, p.unit_id) : null,
        unit_price: Number(p.unit_price ?? item?.purchase_price ?? 0),
        discount_percent: p.discount_in_percent ? Number(p.discount_in_percent) : null,
        tax_id: p.tax_id ?? item?.purchase_tax_id ?? null,
        account_id: p.account_id ?? null,
        is_optional: optional,
      });
    } else if (type === "text") out.push({ type: "text", text: p.text ?? "", is_optional: optional });
    else if (type === "subtotal") out.push({ type: "subtotal", text: p.text ?? "" });
    else if (type === "pagebreak") out.push({ type: "pagebreak" });
  };
  for (const p of (groups.required as Row[]) ?? []) await add(p, false);
  for (const p of (groups.optional as Row[]) ?? []) await add(p, true);
  for (const d of (groups.discount as Row[]) ?? [])
    out.push({ type: "discount", text: d.text ?? "", discount_percent: bool(d.is_percentual) ? Number(d.value) : null, unit_price: bool(d.is_percentual) ? 0 : Number(d.value ?? 0) });
  return out;
}

async function purchaseOrderInput(ctx: Ctx, b: Row, existing: Row | null): Promise<Row> {
  const out = pick(b, {
    document_nr: "nr",
    title: "title",
    contact_id: "contact_id",
    contact_sub_id: "contact_person_id",
    project_id: "project_id",
    header: "header",
    footer: "footer",
    is_valid_from: (v) => ({ date: date(v) }),
    is_valid_to: (v) => ({ due_date: date(v) }),
    is_valid_until: (v, body) => (has(body, "is_valid_to") ? {} : { due_date: date(v) }),
    contact_address_manual: "address",
    delivery_address_manual: "delivery_address",
    reference: "reference",
    mwst_type: (v) => ({ vat_mode: v === "included" ? "incl" : v === "exempt" ? "none" : "excl" }),
  });
  if (has(b, "language_id")) {
    const lang = (await languages(ctx)).byId.get(Number(b.language_id));
    if (lang) out.language = String(lang.code).toLowerCase();
  }
  if (has(b, "currency_id")) out.currency_code = (await currencyCode(ctx, b.currency_id)) ?? "CHF";
  if (b.positions && typeof b.positions === "object") out.positions = await v3Positions(ctx, b.positions as Row);
  void existing;
  return out;
}

function purchaseOrderRoutes(): Route[] {
  const res = getResource("purchase_orders")!;
  const m: Mapping = {
    table: "documents",
    area: "purchases",
    resource: "purchase_orders",
    label: "Purchase order",
    scope: { kind: "purchase_order" },
    columns: { id: "id", document_nr: "nr", title: "title", contact_id: "contact_id", is_valid_from: "date", updated_at: "updated_at" },
    read: (r, ctx) => readPurchaseOrder(ctx, r),
    write: (b, ctx, existing) => purchaseOrderInput(ctx, b, existing),
  };
  const id = (c: CompatCall) => pathId(c, "purchase_order_id");
  return [
    route("GET", "/3.0/purchase_orders", (c) => listWire(c, m)),
    route("POST", "/3.0/purchase_orders", async (c) => created(await createWire(c.ctx, m, bodyObject(c)))),
    route("GET", "/3.0/purchase_orders/{purchase_order_id}", async (c) => wire(c.ctx, m, await loadRow(c.ctx, m, id(c)))),
    route("PUT", "/3.0/purchase_orders/{purchase_order_id}", async (c) => updateWire(c.ctx, m, id(c), bodyObject(c))),
    route("DELETE", "/3.0/purchase_orders/{purchase_order_id}", async (c) => {
      await loadRow(c.ctx, m, id(c));
      await deleteRecord(c.ctx, res, id(c));
      return ok;
    }),
  ];
}

// ------------------------------------------------------------------ all

export function v3Routes(): Route[] {
  return [
    ...accountingRoutes(),
    route("GET", "/3.0/banking/accounts", (c) => listWire(c, bankAccountMapping)),
    route("GET", "/3.0/banking/accounts/{bank_account_id}", async (c) => wire(c.ctx, bankAccountMapping, await loadRow(c.ctx, bankAccountMapping, pathId(c, "bank_account_id")))),
    ...currencyRoutes(),
    route("GET", "/3.0/document_templates", async () => [
      {
        template_slug: "batzio-a4",
        name: "Batzio A4",
        is_default: true,
        default_for_document_types: ["type_offer", "type_order", "type_invoice", "type_delivery", "type_credit_voucher", "type_account_statement", "type_article_order"],
      },
    ]),
    route("GET", "/3.0/permissions", async (c) => {
      const levels = ROLE_PERMISSIONS[c.ctx.role];
      const components = AREAS.filter((a) => levels[a] !== "none");
      return {
        components,
        permissions: Object.fromEntries(
          components.map((a) => [a, { activation: "enabled", edit: levels[a] === "write" && c.ctx.scope === "write" ? "all" : "none", show: "all" }]),
        ),
      };
    }),
    route("GET", "/3.0/taxes", taxList),
    route("GET", "/3.0/taxes/{tax_id}", async (c) => wire(c.ctx, taxMapping, await loadRow(c.ctx, taxMapping, pathId(c, "tax_id")))),
    route("DELETE", "/3.0/taxes/{tax_id}", async (c) => {
      await loadRow(c.ctx, taxMapping, pathId(c, "tax_id"));
      await deleteRecord(c.ctx, getResource("taxes")!, pathId(c, "tax_id"));
      return ok;
    }),
    route("GET", "/3.0/users", async (c) => {
      const { limit, offset } = paging(c.query);
      return (await members(c.ctx)).slice(offset, offset + limit).map((m) => userWire(m));
    }),
    route("GET", "/3.0/users/me", async (c) => {
      const me = (await members(c.ctx)).find((m) => m.user_id === c.ctx.user?.id);
      return userWire(me ?? { user_id: c.ctx.user?.id ?? "", name: c.ctx.user?.name ?? "", email: c.ctx.user?.email ?? "", role: c.ctx.role });
    }),
    route("GET", "/3.0/users/{user_id}", async (c) => {
      const m = (await members(c.ctx)).find((x) => userNumber(x.user_id) === Number(c.params.user_id));
      if (!m) throw notFound("User");
      return userWire(m);
    }),
    ...crud("/3.0/fictional_users", "fictional_user_id", fictionalMapping, ["list", "create", "show", "edit", "delete"], { edit: "PATCH" }),
    ...fileRoutes(),
    ...purchaseOrderRoutes(),
  ];
}
