import { vatFromGross } from "@batzio/core/money";
import { SYSTEM_ACCOUNTS } from "@batzio/core/swiss/chart-of-accounts";
import { auditStatement, sealAuditLog } from "./audit";
import type { Ctx } from "./ctx";
import type { Statement } from "./db/db";
import { AppError } from "./errors";
import { nextNumber } from "./numbering";

export interface AccountRow {
  id: number;
  number: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  group_id: number | null;
  is_active: number;
  is_system: number;
}

export interface TaxRow {
  id: number;
  code: string;
  name: string;
  rate: number;
  type: "sales" | "purchase";
  category: string;
  account_id: number | null;
  vat_form_digit: string | null;
}

export interface EntryLineInput {
  debit_account_id: number;
  credit_account_id: number;
  /** Gross amount in cents (VAT included when a tax is set). */
  amount: number;
  tax_id?: number | null;
  /** Exact VAT in cents; when omitted it is derived from the gross amount and tax rate. */
  vat_amount?: number | null;
  description?: string | null;
  contact_id?: number | null;
}

export interface PostingRow {
  line_index: number;
  account_id: number;
  debit: number;
  credit: number;
  tax_id: number | null;
  tax_role: "base" | "tax" | null;
  description: string | null;
  contra_account_id: number | null;
}

// ---------------------------------------------------------------- lookups

export async function loadAccounts(ctx: Ctx): Promise<Map<number, AccountRow>> {
  const rows = await ctx.db.all<AccountRow>("SELECT * FROM accounts");
  return new Map(rows.map((a) => [a.id, a]));
}

export async function loadTaxes(ctx: Ctx): Promise<Map<number, TaxRow>> {
  const rows = await ctx.db.all<TaxRow>("SELECT * FROM taxes");
  return new Map(rows.map((t) => [t.id, t]));
}

export async function accountIdByNumber(ctx: Ctx, number: string): Promise<number> {
  const id = await ctx.db.value<number>("SELECT id FROM accounts WHERE number = ?", number);
  if (!id) throw new AppError("validation", "Account {number} is missing from the chart of accounts.", undefined, { number });
  return id;
}

export async function systemAccount(ctx: Ctx, key: keyof typeof SYSTEM_ACCOUNTS): Promise<number> {
  return accountIdByNumber(ctx, SYSTEM_ACCOUNTS[key]);
}

// --------------------------------------------------------------- postings

/**
 * Turns booking lines (debit account / credit account / gross amount / tax)
 * into balanced postings, splitting out VAT onto the tax's account:
 *  - sales tax: the revenue side is reduced by the VAT, which is credited to 2200
 *  - input tax: the expense/asset side is reduced by the VAT, which is debited to 1170/1171
 * Reversed lines (e.g. credit notes) split the opposite side automatically.
 */
export function expandPostings(
  lines: EntryLineInput[],
  accounts: Map<number, AccountRow>,
  taxes: Map<number, TaxRow>,
): PostingRow[] {
  const out: PostingRow[] = [];
  lines.forEach((line, index) => {
    const amount = Math.round(line.amount);
    const debitAcc = accounts.get(line.debit_account_id);
    const creditAcc = accounts.get(line.credit_account_id);
    const tax = line.tax_id ? taxes.get(line.tax_id) : undefined;
    const description = line.description ?? null;
    const debit = (account_id: number, value: number, contra: number, tax_id: number | null = null, tax_role: PostingRow["tax_role"] = null) =>
      out.push({ line_index: index, account_id, debit: value, credit: 0, tax_id, tax_role, description, contra_account_id: contra });
    const credit = (account_id: number, value: number, contra: number, tax_id: number | null = null, tax_role: PostingRow["tax_role"] = null) =>
      out.push({ line_index: index, account_id, debit: 0, credit: value, tax_id, tax_role, description, contra_account_id: contra });

    if (!tax) {
      debit(line.debit_account_id, amount, line.credit_account_id);
      credit(line.credit_account_id, amount, line.debit_account_id);
      return;
    }

    let side: "debit" | "credit";
    if (tax.type === "sales") {
      side = debitAcc?.type === "revenue" && creditAcc?.type !== "revenue" ? "debit" : "credit";
    } else {
      side = creditAcc?.type === "expense" && debitAcc?.type !== "expense" ? "credit" : "debit";
    }
    const vat =
      tax.rate > 0 && tax.account_id
        ? line.vat_amount !== null && line.vat_amount !== undefined
          ? Math.round(line.vat_amount)
          : vatFromGross(amount, tax.rate)
        : 0;
    const base = amount - vat;

    if (side === "credit") {
      debit(line.debit_account_id, amount, line.credit_account_id);
      credit(line.credit_account_id, base, line.debit_account_id, tax.id, "base");
      if (vat) credit(tax.account_id!, vat, line.debit_account_id, tax.id, "tax");
    } else {
      debit(line.debit_account_id, base, line.credit_account_id, tax.id, "base");
      if (vat) debit(tax.account_id!, vat, line.credit_account_id, tax.id, "tax");
      credit(line.credit_account_id, amount, line.debit_account_id);
    }
  });
  return out;
}

export async function assertPeriodOpen(ctx: Ctx, date: string) {
  const closed = await ctx.db.first<{ name: string }>(
    "SELECT name FROM business_years WHERE status = 'closed' AND ? BETWEEN start_date AND end_date",
    date,
  );
  if (closed) throw new AppError("locked", "Fiscal year {year} is closed; nothing can be booked on {date}.", undefined, { year: closed.name, date });
}

export async function validateLines(ctx: Ctx, lines: EntryLineInput[], date: string): Promise<void> {
  if (!lines.length) throw new AppError("validation", "A journal entry needs at least one line.", { lines: "Add a line" });
  const accounts = await loadAccounts(ctx);
  lines.forEach((l, i) => {
    if (!l.debit_account_id || !l.credit_account_id) throw new AppError("validation", "Line {n}: debit and credit accounts are required.", undefined, { n: i + 1 });
    if (l.debit_account_id === l.credit_account_id) throw new AppError("validation", "Line {n}: debit and credit account must differ.", undefined, { n: i + 1 });
    if (!accounts.has(l.debit_account_id) || !accounts.has(l.credit_account_id)) throw new AppError("validation", "Line {n}: unknown account.", undefined, { n: i + 1 });
    if (!Number.isFinite(l.amount) || l.amount <= 0) throw new AppError("validation", "Line {n}: amount must be positive.", undefined, { n: i + 1 });
  });
  await assertPeriodOpen(ctx, date);
}

function postingInserts(postings: PostingRow[], date: string, entryIdSql: string, lineIdSql: (index: number) => string): Statement[] {
  return postings.map((p) => ({
    sql: `INSERT INTO postings (entry_id, line_id, date, account_id, debit, credit, tax_id, tax_role, description, contra_account_id)
          VALUES (${entryIdSql}, ${lineIdSql(p.line_index)}, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [date, p.account_id, p.debit, p.credit, p.tax_id, p.tax_role, p.description, p.contra_account_id],
  }));
}

/** Recomputes the postings of an entry from its lines (atomic). */
export async function rebuildPostings(ctx: Ctx, entryId: number): Promise<void> {
  const entry = await ctx.db.first<{ date: string }>("SELECT date FROM journal_entries WHERE id = ?", entryId);
  if (!entry) return;
  const lines = await ctx.db.all<EntryLineInput & { id: number }>(
    "SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort, id",
    entryId,
  );
  const [accounts, taxes] = await Promise.all([loadAccounts(ctx), loadTaxes(ctx)]);
  const postings = expandPostings(lines, accounts, taxes);
  await ctx.db.batch([
    { sql: "DELETE FROM postings WHERE entry_id = ?", params: [entryId] },
    ...postingInserts(postings, entry.date, String(entryId), (i) => String(lines[i].id)),
    {
      sql: "UPDATE journal_entries SET total = ? WHERE id = ?",
      params: [lines.reduce((s, l) => s + l.amount, 0), entryId],
    },
  ]);
}

export interface PostEntryInput {
  date: string;
  description: string;
  type: string;
  sourceType?: string | null;
  sourceId?: number | null;
  lines: EntryLineInput[];
  currency?: string;
  exchangeRate?: number;
  locked?: boolean;
  reversalOfId?: number | null;
}

/** Books an automatic (system) journal entry with its lines and postings in one transaction. */
export async function postEntry(ctx: Ctx, input: PostEntryInput): Promise<number> {
  const lines = input.lines.filter((l) => Math.round(l.amount) !== 0);
  await validateLines(ctx, lines, input.date);
  const [accounts, taxes] = await Promise.all([loadAccounts(ctx), loadTaxes(ctx)]);
  const postings = expandPostings(lines, accounts, taxes);
  const refNr = await nextNumber(ctx, "journal", new Date(`${input.date}T12:00:00Z`));
  const entryId = "(SELECT MAX(id) FROM journal_entries)";
  const statements: Statement[] = [
    {
      sql: `INSERT INTO journal_entries (ref_nr, date, description, type, source_type, source_id, currency_code, exchange_rate, total, is_locked, reversal_of_id, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        refNr,
        input.date,
        input.description,
        input.type,
        input.sourceType ?? null,
        input.sourceId ?? null,
        input.currency ?? "CHF",
        input.exchangeRate ?? 1,
        lines.reduce((s, l) => s + Math.round(l.amount), 0),
        input.locked === false ? 0 : 1,
        input.reversalOfId ?? null,
        ctx.actor.name,
        ctx.actor.name,
      ],
    },
  ];
  lines.forEach((l, i) => {
    statements.push({
      sql: `INSERT INTO journal_lines (entry_id, sort, debit_account_id, credit_account_id, amount, tax_id, vat_amount, description, contact_id)
            VALUES (${entryId}, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        i,
        l.debit_account_id,
        l.credit_account_id,
        Math.round(l.amount),
        l.tax_id ?? null,
        l.vat_amount ?? null,
        l.description ?? null,
        l.contact_id ?? null,
      ],
    });
    statements.push(
      ...postingInserts(
        postings.filter((p) => p.line_index === i),
        input.date,
        entryId,
        () => "(SELECT MAX(id) FROM journal_lines)",
      ),
    );
  });
  statements.push(
    auditStatement(ctx, {
      action: "post",
      resource: "journal_entries",
      resourceIdSql: "SELECT MAX(id) FROM journal_entries",
      summary: `Booked ${refNr}: ${input.description}`,
    }),
  );
  const results = await ctx.db.batch(statements);
  await sealAuditLog(ctx).catch(() => undefined);
  return results[0].lastRowId;
}

/** Books the mirror image of an entry (used for cancellations). */
export async function reverseEntry(ctx: Ctx, entryId: number, date: string, description?: string): Promise<number> {
  const entry = await ctx.db.first<{ id: number; ref_nr: string; description: string; type: string; source_type: string | null; source_id: number | null }>(
    "SELECT * FROM journal_entries WHERE id = ?",
    entryId,
  );
  if (!entry) throw new AppError("not_found", "Journal entry not found.");
  const lines = await ctx.db.all<EntryLineInput>("SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort, id", entryId);
  return postEntry(ctx, {
    date,
    description: description ?? `Reversal of ${entry.ref_nr}: ${entry.description}`,
    type: "reversal",
    sourceType: entry.source_type,
    sourceId: entry.source_id,
    reversalOfId: entry.id,
    lines: lines.map((l) => ({ ...l, debit_account_id: l.credit_account_id, credit_account_id: l.debit_account_id })),
  });
}

// ---------------------------------------------------------------- reports

export interface AccountBalance {
  id: number;
  number: string;
  name: string;
  type: AccountRow["type"];
  group_id: number | null;
  opening: number;
  debit: number;
  credit: number;
  /** Natural-sign balance: positive for normal balances (assets/expenses debit, others credit). */
  balance: number;
}

const debitNormal = (type: string) => type === "asset" || type === "expense";

/**
 * Balances per account for a period. Balance sheet accounts include their
 * opening balance (all postings before `from`); P&L accounts only the period.
 */
export async function accountBalances(
  ctx: Ctx,
  from: string | null,
  to: string,
  opts: { excludeClosing?: boolean } = {},
): Promise<AccountBalance[]> {
  const closingFilter = opts.excludeClosing
    ? "AND p.entry_id NOT IN (SELECT id FROM journal_entries WHERE type = 'closing')"
    : "";
  const rows = await ctx.db.all<{
    id: number;
    number: string;
    name: string;
    type: AccountRow["type"];
    group_id: number | null;
    pre_debit: number | null;
    pre_credit: number | null;
    debit: number | null;
    credit: number | null;
  }>(
    `SELECT a.id, a.number, a.name, a.type, a.group_id,
       SUM(CASE WHEN ? IS NOT NULL AND p.date < ? THEN p.debit ELSE 0 END) AS pre_debit,
       SUM(CASE WHEN ? IS NOT NULL AND p.date < ? THEN p.credit ELSE 0 END) AS pre_credit,
       SUM(CASE WHEN (? IS NULL OR p.date >= ?) AND p.date <= ? THEN p.debit ELSE 0 END) AS debit,
       SUM(CASE WHEN (? IS NULL OR p.date >= ?) AND p.date <= ? THEN p.credit ELSE 0 END) AS credit
     FROM accounts a LEFT JOIN postings p ON p.account_id = a.id ${closingFilter}
     GROUP BY a.id ORDER BY a.number`,
    from, from, from, from, from, from, to, from, from, to,
  );
  return rows.map((r) => {
    const sign = debitNormal(r.type) ? 1 : -1;
    const isBalanceSheet = r.type === "asset" || r.type === "liability" || r.type === "equity";
    const opening = isBalanceSheet ? sign * ((r.pre_debit ?? 0) - (r.pre_credit ?? 0)) : 0;
    const debit = r.debit ?? 0;
    const credit = r.credit ?? 0;
    return {
      id: r.id,
      number: r.number,
      name: r.name,
      type: r.type,
      group_id: r.group_id,
      opening,
      debit,
      credit,
      balance: opening + sign * (debit - credit),
    };
  });
}

export interface ReportLine {
  label: string;
  number?: string;
  amount: number;
  level: 0 | 1 | 2;
  kind: "group" | "account" | "total" | "result";
  accountId?: number;
}

export interface Report {
  title: string;
  period: { from: string | null; to: string };
  sections: { title: string; lines: ReportLine[]; total: number }[];
  result?: { label: string; amount: number };
  balanced?: boolean;
}

export async function balanceSheet(ctx: Ctx, date: string): Promise<Report> {
  const balances = await accountBalances(ctx, null, date);
  const groups = await ctx.db.all<{ id: number; number: string; name: string; parent_id: number | null }>(
    "SELECT id, number, name, parent_id FROM account_groups ORDER BY number",
  );
  const byId = new Map(groups.map((g) => [g.id, g]));
  /** Class (2-digit) and group (3-digit) an account belongs to, following the group tree. */
  const lineage = (a: AccountBalance) => {
    let g = a.group_id ? byId.get(a.group_id) : undefined;
    const chain: { number: string; name: string }[] = [];
    while (g) {
      chain.unshift({ number: g.number, name: g.name });
      g = g.parent_id ? byId.get(g.parent_id) : undefined;
    }
    const cls = chain.find((c) => c.number.length === 2) ?? { number: a.number.slice(0, 2), name: a.number.slice(0, 2) };
    const grp = chain.find((c) => c.number.length === 3) ?? cls;
    return { cls, grp };
  };

  // Unclosed P&L becomes the current-year result inside equity.
  const profit =
    balances.filter((b) => b.type === "revenue").reduce((s, b) => s + b.balance, 0) -
    balances.filter((b) => b.type === "expense").reduce((s, b) => s + b.balance, 0);

  const section = (title: string, filter: (b: AccountBalance) => boolean, extra: ReportLine[] = []) => {
    const lines: ReportLine[] = [];
    const accounts = balances.filter((b) => filter(b) && b.balance !== 0).sort((a, b) => a.number.localeCompare(b.number));
    const classes = new Map<string, { name: string; groups: Map<string, { name: string; accounts: AccountBalance[] }> }>();
    for (const a of accounts) {
      const { cls, grp } = lineage(a);
      const c = classes.get(cls.number) ?? { name: cls.name, groups: new Map() };
      const g = c.groups.get(grp.number) ?? { name: grp.name, accounts: [] };
      g.accounts.push(a);
      c.groups.set(grp.number, g);
      classes.set(cls.number, c);
    }
    for (const [clsNumber, c] of [...classes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const clsSum = [...c.groups.values()].flatMap((g) => g.accounts).reduce((s, a) => s + a.balance, 0);
      lines.push({ label: c.name, number: clsNumber, amount: clsSum, level: 0, kind: "group" });
      for (const [grpNumber, g] of [...c.groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (grpNumber !== clsNumber && c.groups.size > 1) {
          lines.push({ label: g.name, number: grpNumber, amount: g.accounts.reduce((s, a) => s + a.balance, 0), level: 1, kind: "group" });
        }
        for (const a of g.accounts) lines.push({ label: a.name, number: a.number, amount: a.balance, level: 2, kind: "account", accountId: a.id });
      }
    }
    lines.push(...extra);
    const total = lines.filter((l) => l.kind === "account" || l.kind === "result").reduce((s, l) => s + l.amount, 0);
    lines.push({ label: `Total ${title.toLowerCase()}`, amount: total, level: 0, kind: "total" });
    return { title, lines, total };
  };

  const assets = section("Assets", (b) => b.type === "asset");
  const liabilities = section("Liabilities", (b) => b.type === "liability");
  const equity = section("Equity", (b) => b.type === "equity", profit ? [{ label: "Profit / loss of the current period", amount: profit, level: 2, kind: "result" }] : []);
  const passive = liabilities.total + equity.total;
  return {
    title: "Balance sheet",
    period: { from: null, to: date },
    sections: [assets, liabilities, equity],
    result: { label: "Total liabilities and equity", amount: passive },
    balanced: assets.total === passive,
  };
}

/** Staged Swiss income statement (gross profit I/II, EBITDA, EBIT, EBT, net profit). */
export async function incomeStatement(ctx: Ctx, from: string, to: string): Promise<Report> {
  const balances = (await accountBalances(ctx, from, to, { excludeClosing: true })).filter(
    (b) => b.type === "revenue" || b.type === "expense",
  );
  const n = (b: AccountBalance) => Number(b.number);
  const signed = (b: AccountBalance) => (b.type === "revenue" ? b.balance : -b.balance);

  const stages: { title: string; filter: (b: AccountBalance) => boolean; result: string }[] = [
    { title: "Operating revenue", filter: (b) => n(b) >= 3000 && n(b) < 4000, result: "Net revenue" },
    { title: "Cost of materials, goods and services", filter: (b) => n(b) >= 4000 && n(b) < 5000, result: "Gross profit I" },
    { title: "Personnel expenses", filter: (b) => n(b) >= 5000 && n(b) < 6000, result: "Gross profit II" },
    { title: "Other operating expenses", filter: (b) => n(b) >= 6000 && n(b) < 6800, result: "EBITDA" },
    { title: "Depreciation and impairment", filter: (b) => n(b) >= 6800 && n(b) < 6900, result: "EBIT (operating result)" },
    { title: "Financial result", filter: (b) => n(b) >= 6900 && n(b) < 7000, result: "Operating result after financial result" },
    { title: "Ancillary operating result", filter: (b) => n(b) >= 7000 && n(b) < 8000, result: "Operating result incl. ancillary activities" },
    { title: "Non-operating and extraordinary result", filter: (b) => n(b) >= 8000 && n(b) < 8900, result: "Profit before taxes (EBT)" },
    { title: "Direct taxes", filter: (b) => n(b) >= 8900 && n(b) < 9000, result: "Net profit / loss" },
  ];

  let running = 0;
  const sections: Report["sections"] = [];
  for (const stage of stages) {
    const accounts = balances.filter((b) => stage.filter(b) && (b.debit || b.credit));
    const total = accounts.reduce((s, b) => s + signed(b), 0);
    running += total;
    if (!accounts.length && stage.title !== "Operating revenue") {
      continue;
    }
    sections.push({
      title: stage.title,
      lines: [
        ...accounts.map((a) => ({ label: a.name, number: a.number, amount: signed(a), level: 1 as const, kind: "account" as const, accountId: a.id })),
        { label: stage.result, amount: running, level: 0, kind: "result" },
      ],
      total,
    });
  }
  return {
    title: "Income statement",
    period: { from, to },
    sections,
    result: { label: "Net profit / loss", amount: running },
  };
}

export async function trialBalance(ctx: Ctx, from: string, to: string) {
  const balances = await accountBalances(ctx, from, to);
  const rows = balances.filter((b) => b.opening || b.debit || b.credit);
  return {
    period: { from, to },
    rows,
    totals: {
      debit: rows.reduce((s, r) => s + r.debit, 0),
      credit: rows.reduce((s, r) => s + r.credit, 0),
    },
  };
}

export interface LedgerRow {
  posting_id: number;
  entry_id: number;
  date: string;
  ref_nr: string | null;
  description: string | null;
  contra: string | null;
  debit: number;
  credit: number;
  balance: number;
  tax_code: string | null;
}

export async function accountLedger(ctx: Ctx, accountId: number, from: string, to: string) {
  const account = await ctx.db.first<AccountRow>("SELECT * FROM accounts WHERE id = ?", accountId);
  if (!account) throw new AppError("not_found", "Account not found.");
  const sign = debitNormal(account.type) ? 1 : -1;
  const isBalanceSheet = !["revenue", "expense"].includes(account.type);
  const pre = isBalanceSheet
    ? await ctx.db.first<{ d: number | null; c: number | null }>(
        "SELECT SUM(debit) AS d, SUM(credit) AS c FROM postings WHERE account_id = ? AND date < ?",
        accountId,
        from,
      )
    : null;
  const opening = pre ? sign * ((pre.d ?? 0) - (pre.c ?? 0)) : 0;
  const rows = await ctx.db.all<Omit<LedgerRow, "balance">>(
    `SELECT p.id AS posting_id, p.entry_id, p.date, e.ref_nr,
            COALESCE(p.description, e.description) AS description,
            ca.number || ' ' || ca.name AS contra, p.debit, p.credit, t.code AS tax_code
     FROM postings p
     JOIN journal_entries e ON e.id = p.entry_id
     LEFT JOIN accounts ca ON ca.id = p.contra_account_id
     LEFT JOIN taxes t ON t.id = p.tax_id
     WHERE p.account_id = ? AND p.date BETWEEN ? AND ?
     ORDER BY p.date, p.entry_id, p.id`,
    accountId,
    from,
    to,
  );
  let balance = opening;
  const out: LedgerRow[] = rows.map((r) => {
    balance += sign * (r.debit - r.credit);
    return { ...r, balance };
  });
  return {
    account,
    period: { from, to },
    opening,
    rows: out,
    closing: balance,
    totals: { debit: rows.reduce((s, r) => s + r.debit, 0), credit: rows.reduce((s, r) => s + r.credit, 0) },
  };
}

export interface VatReportLine {
  tax_id: number;
  code: string;
  name: string;
  rate: number;
  type: "sales" | "purchase";
  digit: string | null;
  base: number;
  tax: number;
}

/** VAT return figures (effective method) for a period, by tax code and ESTV form digit. */
export async function vatReport(ctx: Ctx, from: string, to: string) {
  const rows = await ctx.db.all<{
    tax_id: number;
    code: string;
    name: string;
    rate: number;
    type: "sales" | "purchase";
    digit: string | null;
    base_credit: number | null;
    base_debit: number | null;
    tax_credit: number | null;
    tax_debit: number | null;
  }>(
    `SELECT t.id AS tax_id, t.code, t.name, t.rate, t.type, t.vat_form_digit AS digit,
       SUM(CASE WHEN p.tax_role = 'base' THEN p.credit ELSE 0 END) AS base_credit,
       SUM(CASE WHEN p.tax_role = 'base' THEN p.debit ELSE 0 END) AS base_debit,
       SUM(CASE WHEN p.tax_role = 'tax' THEN p.credit ELSE 0 END) AS tax_credit,
       SUM(CASE WHEN p.tax_role = 'tax' THEN p.debit ELSE 0 END) AS tax_debit
     FROM postings p JOIN taxes t ON t.id = p.tax_id
     WHERE p.date BETWEEN ? AND ?
     GROUP BY t.id ORDER BY t.type DESC, t.code`,
    from,
    to,
  );
  const lines: VatReportLine[] = rows.map((r) => {
    const salesSign = r.type === "sales" ? 1 : -1;
    return {
      tax_id: r.tax_id,
      code: r.code,
      name: r.name,
      rate: r.rate,
      type: r.type,
      digit: r.digit,
      base: salesSign * ((r.base_credit ?? 0) - (r.base_debit ?? 0)),
      tax: salesSign * ((r.tax_credit ?? 0) - (r.tax_debit ?? 0)),
    };
  });
  const sales = lines.filter((l) => l.type === "sales");
  const purchases = lines.filter((l) => l.type === "purchase");
  const byDigit = (d: string, key: "base" | "tax") => lines.filter((l) => l.digit === d).reduce((s, l) => s + l[key], 0);
  const taxDue = sales.reduce((s, l) => s + l.tax, 0);
  const inputTax = purchases.reduce((s, l) => s + l.tax, 0);
  const totalTurnover = sales.reduce((s, l) => s + l.base, 0);
  const deductions = byDigit("221", "base") + byDigit("230", "base");
  const digits = {
    "200": totalTurnover,
    "221": byDigit("221", "base"),
    "230": byDigit("230", "base"),
    "289": deductions,
    "299": totalTurnover - deductions,
    "303": byDigit("303", "base"),
    "303_tax": byDigit("303", "tax"),
    "313": byDigit("313", "base"),
    "313_tax": byDigit("313", "tax"),
    "343": byDigit("343", "base"),
    "343_tax": byDigit("343", "tax"),
    "399": taxDue,
    "400": byDigit("400", "tax"),
    "405": byDigit("405", "tax"),
    "479": inputTax,
    "500": Math.max(0, taxDue - inputTax),
    "510": Math.max(0, inputTax - taxDue),
  };
  return { period: { from, to }, lines, totals: { taxDue, inputTax, payable: taxDue - inputTax }, digits };
}

/** Moves the VAT balances of a period to the settlement account (2201). */
export async function settleVat(ctx: Ctx, from: string, to: string): Promise<number | null> {
  const report = await vatReport(ctx, from, to);
  const taxes = await loadTaxes(ctx);
  const settlement = await systemAccount(ctx, "vatSettlement");
  const lines: EntryLineInput[] = [];
  const byAccount = new Map<number, number>();
  for (const l of report.lines) {
    const account = taxes.get(l.tax_id)?.account_id;
    if (!account || !l.tax) continue;
    byAccount.set(account, (byAccount.get(account) ?? 0) + (l.type === "sales" ? l.tax : -l.tax));
  }
  for (const [account, amount] of byAccount) {
    if (!amount) continue;
    // Sales VAT (credit balance) is debited out; input VAT (debit balance) is credited out.
    lines.push(
      amount > 0
        ? { debit_account_id: account, credit_account_id: settlement, amount, description: "VAT settlement" }
        : { debit_account_id: settlement, credit_account_id: account, amount: -amount, description: "VAT settlement" },
    );
  }
  if (!lines.length) return null;
  return postEntry(ctx, { date: to, description: `VAT settlement ${from} – ${to}`, type: "vat_settlement", lines });
}

/**
 * Closes a business year: books the period result to 2979 (profit/loss for the
 * year) via 9200 and locks all bookings dated inside the year.
 */
export async function closeBusinessYear(ctx: Ctx, yearId: number): Promise<{ profit: number; entryId: number | null }> {
  const year = await ctx.db.first<{ id: number; name: string; start_date: string; end_date: string; status: string }>(
    "SELECT * FROM business_years WHERE id = ?",
    yearId,
  );
  if (!year) throw new AppError("not_found", "Business year not found.");
  if (year.status === "closed") throw new AppError("conflict", "This business year is already closed.");
  const open = await ctx.db.value<number>(
    "SELECT COUNT(*) FROM business_years WHERE status = 'open' AND end_date < ?",
    year.start_date,
  );
  if (open) throw new AppError("conflict", "Close earlier business years first.");

  const statement = await incomeStatement(ctx, year.start_date, year.end_date);
  const profit = statement.result?.amount ?? 0;
  let entryId: number | null = null;
  if (profit !== 0) {
    const [pl, annual] = await Promise.all([systemAccount(ctx, "profitLoss"), systemAccount(ctx, "annualProfit")]);
    // Transfer each P&L account balance to 9200, then 9200 to 2979.
    const balances = (await accountBalances(ctx, year.start_date, year.end_date, { excludeClosing: true })).filter(
      (b) => (b.type === "revenue" || b.type === "expense") && b.balance !== 0,
    );
    const lines: EntryLineInput[] = balances.map((b) => {
      const debitBalance = b.debit - b.credit;
      return debitBalance > 0
        ? { debit_account_id: pl, credit_account_id: b.id, amount: debitBalance, description: `Closing ${b.number}` }
        : { debit_account_id: b.id, credit_account_id: pl, amount: -debitBalance, description: `Closing ${b.number}` };
    });
    lines.push(
      profit > 0
        ? { debit_account_id: pl, credit_account_id: annual, amount: profit, description: "Result for the year" }
        : { debit_account_id: annual, credit_account_id: pl, amount: -profit, description: "Result for the year" },
    );
    entryId = await postEntry(ctx, { date: year.end_date, description: `Year-end closing ${year.name}`, type: "closing", lines });
  }
  await ctx.db.batch([
    { sql: "UPDATE journal_entries SET is_locked = 1 WHERE date BETWEEN ? AND ?", params: [year.start_date, year.end_date] },
    {
      sql: "UPDATE business_years SET status = 'closed', closed_at = ?, closing_entry_id = ?, updated_by = ? WHERE id = ?",
      params: [new Date().toISOString(), entryId, ctx.actor.name, yearId],
    },
  ]);
  return { profit, entryId };
}
