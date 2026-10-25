import { today } from "@/lib/format";
import { toCents } from "@/lib/money";
import { bestMatch } from "@/lib/quick/autopilot";
import { getResource } from "@/lib/resources/registry";
import { accountIdByNumber, postEntry, type EntryLineInput } from "@/lib/server/accounting";
import { importStatements, type ParsedTransaction } from "@/lib/server/banking";
import { createRecord } from "@/lib/server/crud";
import type { Ctx } from "@/lib/server/ctx";
import { toAppError } from "@/lib/server/errors";
import { cell, cellText, looseDate, looseNumber, type Table, type TableKind } from "./tables";

export interface RecordRef {
  resource: string;
  id: number;
  label: string;
}

export interface ImportResult {
  kind: TableKind;
  created: number;
  skipped: number;
  errors: string[];
  records: RecordRef[];
  summary: string;
}

const result = (kind: TableKind): ImportResult => ({ kind, created: 0, skipped: 0, errors: [], records: [], summary: "" });

async function importContacts(ctx: Ctx, table: Table, m: Record<string, number>, supplier: boolean): Promise<ImportResult> {
  const out = result("contacts");
  const res = getResource("contacts")!;
  const existing = (await ctx.db.all<{ id: number; name_1: string }>("SELECT id, name_1 FROM contacts WHERE archived_at IS NULL")).map((c) => c.name_1);
  for (const [i, row] of table.rows.entries()) {
    const company = cellText(row, m, "name");
    const last = cellText(row, m, "last_name");
    const first = cellText(row, m, "first_name");
    const name1 = company ?? last;
    if (!name1) {
      out.skipped++;
      continue;
    }
    if (bestMatch(name1, existing, (n) => n, 0.95)) {
      out.skipped++;
      continue;
    }
    const isPerson = !company && !!last;
    try {
      const country = cellText(row, m, "country");
      const street = cellText(row, m, "street");
      const streetMatch = street?.match(/^(.*?)\s+(\d+\w?)$/);
      const record = await createRecord(ctx, res, {
        type: isPerson ? "person" : "company",
        name_1: name1,
        name_2: isPerson ? first : null,
        email: cellText(row, m, "email"),
        phone: cellText(row, m, "phone"),
        street: streetMatch ? streetMatch[1] : street,
        house_number: streetMatch ? streetMatch[2] : null,
        postcode: cellText(row, m, "postcode"),
        city: cellText(row, m, "city"),
        country_code: country && country.length === 2 ? country.toUpperCase() : "CH",
        website: cellText(row, m, "website"),
        vat_number: cellText(row, m, "vat"),
        iban: cellText(row, m, "iban")?.replace(/\s+/g, "") ?? null,
        is_customer: !supplier,
        is_supplier: supplier,
      });
      existing.push(name1);
      out.created++;
      out.records.push({ resource: "contacts", id: Number(record.id), label: name1 });
    } catch (e) {
      out.errors.push(`Row ${i + 2}: ${toAppError(e).message}`);
    }
  }
  out.summary = `${out.created} contact(s) imported, ${out.skipped} skipped`;
  return out;
}

async function importItems(ctx: Ctx, table: Table, m: Record<string, number>): Promise<ImportResult> {
  const out = result("items");
  const res = getResource("items")!;
  const units = await ctx.db.all<{ id: number; name: string }>("SELECT id, name FROM units");
  const existing = (await ctx.db.all<{ name: string }>("SELECT name FROM items")).map((i) => i.name);
  for (const [i, row] of table.rows.entries()) {
    const name = cellText(row, m, "item_name") ?? cellText(row, m, "name");
    if (!name || existing.includes(name)) {
      out.skipped++;
      continue;
    }
    const unitText = cellText(row, m, "unit");
    const unit = unitText ? bestMatch(unitText, units, (u) => u.name, 0.6) : null;
    try {
      const record = await createRecord(ctx, res, {
        name,
        nr: cellText(row, m, "sku"),
        description: m.description !== undefined && m.description !== m.item_name ? cellText(row, m, "description") : null,
        type: unitText && /^(h|std|hour|stunde|heure|ora)/i.test(unitText) ? "service" : "product",
        unit_id: unit?.id ?? null,
        sale_price: looseNumber(cell(row, m, "price")),
        purchase_price: looseNumber(cell(row, m, "cost")),
      });
      existing.push(name);
      out.created++;
      out.records.push({ resource: "items", id: Number(record.id), label: name });
    } catch (e) {
      out.errors.push(`Row ${i + 2}: ${toAppError(e).message}`);
    }
  }
  out.summary = `${out.created} product(s) imported, ${out.skipped} skipped`;
  return out;
}

/** Books an opening balance entry (against 9100) from an account/balance list. */
export async function importOpeningBalances(ctx: Ctx, table: Table, m: Record<string, number>, date?: string | null): Promise<ImportResult> {
  const out = result("opening_balances");
  const accounts = await ctx.db.all<{ id: number; number: string; type: string }>("SELECT id, number, type FROM accounts");
  const opening = await accountIdByNumber(ctx, "9100");
  const lines: EntryLineInput[] = [];
  for (const row of table.rows) {
    const raw = cellText(row, m, "account");
    const number = raw?.match(/\d{3,5}/)?.[0];
    const account = number ? accounts.find((a) => a.number === number) : undefined;
    if (!account) {
      if (raw) out.errors.push(`Unknown account ${raw}`);
      out.skipped++;
      continue;
    }
    // Balances are given in their natural sign (assets as positive debit balances, liabilities as positive credit balances).
    let amount = looseNumber(cell(row, m, "balance"));
    if (amount === null) amount = (looseNumber(cell(row, m, "debit")) ?? 0) - (looseNumber(cell(row, m, "credit")) ?? 0);
    else if (!(account.type === "asset" || account.type === "expense")) amount = -amount;
    const cents = toCents(amount);
    if (!cents) {
      out.skipped++;
      continue;
    }
    lines.push(
      cents > 0
        ? { debit_account_id: account.id, credit_account_id: opening, amount: cents, description: `Opening ${account.number}` }
        : { debit_account_id: opening, credit_account_id: account.id, amount: -cents, description: `Opening ${account.number}` },
    );
  }
  if (lines.length) {
    const year = (date ?? today()).slice(0, 4);
    const id = await postEntry(ctx, { date: date ?? `${year}-01-01`, description: "Opening balances (imported)", type: "opening", locked: false, lines });
    out.created = lines.length;
    out.records.push({ resource: "journal_entries", id, label: "Opening balances" });
  }
  out.summary = `${lines.length} opening balance(s) booked, ${out.skipped} skipped`;
  return out;
}

async function importBankLines(ctx: Ctx, table: Table, m: Record<string, number>, bankAccountId?: number | null): Promise<ImportResult> {
  const out = result("bank_lines");
  const transactions: ParsedTransaction[] = [];
  for (const [i, row] of table.rows.entries()) {
    const date = looseDate(cell(row, m, "date"));
    let amount = looseNumber(cell(row, m, "amount"));
    if (amount === null) amount = (looseNumber(cell(row, m, "credit")) ?? 0) - (looseNumber(cell(row, m, "debit")) ?? 0);
    if (!date || !amount) {
      out.skipped++;
      continue;
    }
    const text = cellText(row, m, "text");
    transactions.push({
      bookingDate: date,
      valueDate: null,
      amount: toCents(amount),
      currency: "CHF",
      counterparty: null,
      counterpartyIban: null,
      reference: cellText(row, m, "reference")?.replace(/\s+/g, "") ?? null,
      remittance: text,
      externalId: `table-${date}-${toCents(amount)}-${i}-${(text ?? "").slice(0, 40)}`,
    });
  }
  const r = await importStatements(ctx, [{ iban: null, transactions }], { bankAccountId, autoBook: true });
  out.created = r.imported;
  out.skipped += r.duplicates;
  out.summary = `${r.imported} bank line(s) imported (${r.duplicates} duplicates, ${r.suggested} matched, ${r.booked} booked)`;
  return out;
}

export async function importTable(
  ctx: Ctx,
  table: Table,
  kind: TableKind,
  mapping: Record<string, number>,
  options: { supplier?: boolean; date?: string | null; bankAccountId?: number | null } = {},
): Promise<ImportResult> {
  switch (kind) {
    case "contacts":
      return importContacts(ctx, table, mapping, !!options.supplier);
    case "items":
      return importItems(ctx, table, mapping);
    case "opening_balances":
      return importOpeningBalances(ctx, table, mapping, options.date);
    case "bank_lines":
      return importBankLines(ctx, table, mapping, options.bankAccountId);
    default:
      return { ...result("unknown"), summary: "I could not tell what this table contains." };
  }
}
