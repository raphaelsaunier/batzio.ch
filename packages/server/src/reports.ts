import { formatDate, today } from "@batzio/core/format";
import { VAT_FORM_DIGITS } from "@batzio/core/swiss/vat";
import type { Area } from "@batzio/core/permissions";
import { N_, type TFunction } from "@batzio/i18n";
import { termFor } from "@batzio/i18n/glossary";
import { accountLedger, balanceSheet, incomeStatement, trialBalance, vatReport, type Report } from "./accounting";
import { assertCan, type Ctx } from "./ctx";
import { liquidityForecast, openItems } from "./dashboard";
import { AppError } from "./errors";
import { salarySummary } from "./payroll";
import type { CellType, Sheet } from "./xlsx";

/**
 * Every report as display-ready tables. The web renders bespoke pages, the
 * native apps render these tables as they are, and every report gets an XLSX
 * export from the same rows.
 */

export type ReportParams = "date" | "period" | "ledger" | "year" | "none";

export interface ReportInfo {
  id: string;
  title: string;
  text: string;
  icon: string;
  area: Area;
  params: ReportParams;
  /** Path of the typeset PDF under /api/v1 (when there is one). */
  pdf?: string;
}

export const REPORT_CATALOG: ReportInfo[] = [
  { id: "balance-sheet", title: N_("Balance sheet"), text: N_("Assets, liabilities and equity as of a date, structured by the SME chart of accounts."), icon: "Scale", area: "accounting", params: "date", pdf: "/reports/balance-sheet" },
  { id: "income-statement", title: N_("Income statement"), text: N_("Staged profit and loss: gross profit, EBITDA, EBIT and net result."), icon: "TrendingUp", area: "accounting", params: "period", pdf: "/reports/income-statement" },
  { id: "trial-balance", title: N_("Trial balance"), text: N_("Opening balance, debit, credit and closing balance of every account."), icon: "FileSpreadsheet", area: "accounting", params: "period", pdf: "/reports/trial-balance" },
  { id: "vat", title: N_("VAT return"), text: N_("Figures for the ESTV VAT return (effective method) by form digit and VAT code."), icon: "Percent", area: "accounting", params: "period", pdf: "/reports/vat" },
  { id: "ledger", title: N_("Account ledger"), text: N_("All postings of an account with contra account and running balance."), icon: "BookOpen", area: "accounting", params: "ledger", pdf: "/reports/ledger" },
  { id: "journal", title: N_("Journal"), text: N_("Chronological list of all bookings with their debit/credit lines."), icon: "NotebookPen", area: "accounting", params: "period" },
  { id: "receivables", title: N_("Open receivables"), text: N_("Unpaid customer invoices with ageing buckets."), icon: "HandCoins", area: "sales", params: "none" },
  { id: "payables", title: N_("Open payables"), text: N_("Unpaid supplier bills with due dates and ageing."), icon: "CalendarClock", area: "purchases", params: "none" },
  { id: "liquidity", title: N_("Liquidity forecast"), text: N_("Bank balance plus expected receipts and payments by week."), icon: "Landmark", area: "banking", params: "none" },
  { id: "salaries", title: N_("Salary summary"), text: N_("Annual payroll totals per employee as basis for salary certificates."), icon: "Users", area: "payroll", params: "year" },
];

export type ColumnType = "text" | "code" | "date" | "number" | "money";

export interface ReportColumn {
  label: string;
  type: ColumnType;
  /** Glossary id for a jargon tooltip. */
  term?: string | null;
}

export interface ReportRow {
  cells: (string | number | null)[];
  style?: "section" | "total" | "muted";
  indent?: number;
  /** Record the row stands for, so a tap can open it. */
  link?: { resource: string; id: number };
}

export interface ReportTable {
  title?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

export interface ReportView {
  id: string;
  title: string;
  subtitle: string;
  params: ReportParams;
  /** Echo of the effective parameters (defaults filled in). */
  query: Record<string, string>;
  summary: { label: string; value: number; tone?: "danger" | "success" }[];
  tables: ReportTable[];
  balanced?: boolean;
  pdf?: string;
}

export interface ReportQuery {
  date?: string;
  from?: string;
  to?: string;
  account_id?: number;
  account_number?: string;
  year?: number;
}

const major = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : Number(cents) / 100);

export async function reportView(ctx: Ctx, id: string, query: ReportQuery, t: TFunction, company = ctx.tenant.name): Promise<ReportView> {
  const info = REPORT_CATALOG.find((r) => r.id === id);
  if (!info) throw new AppError("not_found", "Unknown report {name}.", undefined, { name: id });
  assertCan(ctx, info.area, "read");
  const year = today().slice(0, 4);
  const from = query.from ?? `${year}-01-01`;
  const to = query.to ?? `${year}-12-31`;
  const col = (label: string, type: ColumnType = "text"): ReportColumn => ({ label: t(label), type, term: termFor(label) });
  const range = `${formatDate(from)} – ${formatDate(to)}`;
  const base = { id, title: t(info.title), params: info.params, pdf: info.pdf, summary: [] as ReportView["summary"] };
  void company;

  switch (id) {
    case "balance-sheet":
    case "income-statement": {
      const date = query.date ?? today();
      const r: Report = id === "balance-sheet" ? await balanceSheet(ctx, date) : await incomeStatement(ctx, from, to);
      return {
        ...base,
        subtitle: id === "balance-sheet" ? t("As of {date}", { date: formatDate(date) }) : range,
        query: id === "balance-sheet" ? { date } : { from, to },
        balanced: r.balanced,
        summary: r.result ? [{ label: t(r.result.label), value: r.result.amount / 100, tone: r.result.amount < 0 ? "danger" : "success" }] : [],
        tables: r.sections.map((s) => ({
          title: t(s.title),
          columns: [col("Account", "code"), col("Description"), col("Amount", "money")],
          rows: s.lines.map((l) => ({
            cells: [l.number ?? null, l.kind === "account" ? l.label : t(l.label), major(l.amount)],
            style: l.kind === "account" ? undefined : l.kind === "group" ? "section" : "total",
            indent: l.level,
            link: l.accountId ? { resource: "accounts", id: l.accountId } : undefined,
          })),
        })),
      };
    }
    case "trial-balance": {
      const tb = await trialBalance(ctx, from, to);
      return {
        ...base,
        subtitle: range,
        query: { from, to },
        tables: [
          {
            columns: [col("Account", "code"), col("Name"), col("Opening", "money"), col("Debit", "money"), col("Credit", "money"), col("Balance", "money")],
            rows: [
              ...tb.rows.map((r) => ({ cells: [r.number, r.name, major(r.opening), major(r.debit), major(r.credit), major(r.balance)] })),
              { cells: [null, t("Total"), null, major(tb.totals.debit), major(tb.totals.credit), null], style: "total" as const },
            ],
          },
        ],
      };
    }
    case "vat": {
      const v = await vatReport(ctx, from, to);
      const d = v.digits as Record<string, number>;
      const line = (digit: string, base: number | null, tax: number | null, total = false): ReportRow => ({
        cells: [digit, t(VAT_FORM_DIGITS[digit as keyof typeof VAT_FORM_DIGITS] ?? digit), major(base), major(tax)],
        style: total ? "total" : undefined,
      });
      return {
        ...base,
        subtitle: range,
        query: { from, to },
        summary: [{ label: t("VAT payable"), value: (d["500"] ?? 0) / 100 }],
        tables: [
          {
            title: t("VAT return"),
            columns: [col("Digit", "code"), col("Description"), col("Turnover / base", "money"), col("Tax", "money")],
            rows: [
              line("200", d["200"], null),
              line("221", d["221"], null),
              line("230", d["230"], null),
              line("289", d["289"], null),
              line("299", d["299"], null, true),
              line("303", d["303"], d["303_tax"]),
              line("313", d["313"], d["313_tax"]),
              line("343", d["343"], d["343_tax"]),
              line("399", null, d["399"], true),
              line("400", null, d["400"]),
              line("405", null, d["405"]),
              line("479", null, d["479"], true),
              line("500", null, d["500"], true),
              line("510", null, d["510"], true),
            ],
          },
          {
            title: t("By VAT code"),
            columns: [col("Code", "code"), col("Name"), col("Rate %", "number"), col("Digit", "code"), col("Base", "money"), col("Tax", "money")],
            rows: v.lines.map((l) => ({ cells: [l.code, l.name, l.rate, l.digit, major(l.base), major(l.tax)] })),
          },
        ],
      };
    }
    case "ledger": {
      let accountId = query.account_id ?? null;
      if (!accountId && query.account_number) accountId = await ctx.db.value<number>("SELECT id FROM accounts WHERE number = ?", query.account_number);
      if (!accountId) accountId = await ctx.db.value<number>("SELECT id FROM accounts WHERE number = '1020'");
      if (!accountId) throw new AppError("validation", "Provide account_id or account_number.");
      const l = await accountLedger(ctx, accountId, from, to);
      return {
        ...base,
        title: `${t(info.title)} ${l.account.number} ${l.account.name}`,
        subtitle: range,
        query: { from, to, account_id: String(accountId) },
        summary: [{ label: t("Closing balance"), value: l.closing / 100 }],
        tables: [
          {
            columns: [col("Date", "date"), col("Reference", "code"), col("Description"), col("Contra account"), col("VAT", "code"), col("Debit", "money"), col("Credit", "money"), col("Balance", "money")],
            rows: [
              { cells: [null, null, t("Opening balance"), null, null, null, null, major(l.opening)], style: "total" },
              ...l.rows.map((r) => ({
                cells: [r.date, r.ref_nr, r.description, r.contra, r.tax_code, r.debit ? major(r.debit) : null, r.credit ? major(r.credit) : null, major(r.balance)],
                link: r.entry_id ? { resource: "journal_entries", id: Number(r.entry_id) } : undefined,
              })),
              { cells: [null, null, t("Closing balance"), null, null, major(l.totals.debit), major(l.totals.credit), major(l.closing)], style: "total" },
            ],
          },
        ],
      };
    }
    case "journal": {
      const entries = await ctx.db.all<{ id: number; ref_nr: string; date: string; description: string }>(
        "SELECT id, ref_nr, date, description FROM journal_entries WHERE date BETWEEN ? AND ? ORDER BY date, id LIMIT 500",
        from,
        to,
      );
      const lines = await ctx.db.all<{ entry_id: number; debit: string; credit: string; amount: number; tax: string | null; description: string | null }>(
        `SELECT l.entry_id, da.number || ' ' || da.name AS debit, ca.number || ' ' || ca.name AS credit, l.amount, t.code AS tax, l.description
         FROM journal_lines l JOIN accounts da ON da.id = l.debit_account_id JOIN accounts ca ON ca.id = l.credit_account_id
         LEFT JOIN taxes t ON t.id = l.tax_id
         WHERE l.entry_id IN (SELECT id FROM journal_entries WHERE date BETWEEN ? AND ?) ORDER BY l.entry_id, l.sort`,
        from,
        to,
      );
      const rows: ReportRow[] = [];
      for (const e of entries) {
        lines
          .filter((l) => l.entry_id === e.id)
          .forEach((l, i) =>
            rows.push({
              cells: [i === 0 ? e.date : null, i === 0 ? e.ref_nr : null, i === 0 ? e.description : l.description, l.debit, l.credit, l.tax, major(l.amount)],
              style: i === 0 ? undefined : "muted",
              link: { resource: "journal_entries", id: e.id },
            }),
          );
      }
      return {
        ...base,
        subtitle: range,
        query: { from, to },
        tables: [{ columns: [col("Date", "date"), col("Ref.", "code"), col("Description"), col("Debit"), col("Credit"), col("VAT", "code"), col("Amount", "money")], rows }],
      };
    }
    case "receivables":
    case "payables": {
      const r = await openItems(ctx, id);
      const resource = id === "receivables" ? "invoices" : "bills";
      return {
        ...base,
        subtitle: t("As of {date}", { date: formatDate(today()) }),
        query: {},
        summary: (Object.entries(r.buckets) as [string, number][]).map(([bucket, amount]) => ({
          label: bucket === "current" ? t("Not yet due") : t("{range} days", { range: bucket }),
          value: amount / 100,
          tone: bucket !== "current" && amount > 0 ? "danger" : undefined,
        })),
        tables: [
          {
            columns: [col("Number", "code"), col(id === "receivables" ? "Customer" : "Supplier"), col("Date", "date"), col("Due", "date"), col("Days overdue", "number"), col("Total", "money"), col("Open", "money")],
            rows: r.items.map((i) => ({ cells: [i.nr, i.contact, i.date, i.due_date, i.days_overdue || null, major(i.total), major(i.open)], link: { resource, id: i.id } })),
          },
        ],
      };
    }
    case "liquidity": {
      const r = await liquidityForecast(ctx);
      return {
        ...base,
        subtitle: t("As of {date}", { date: formatDate(today()) }),
        query: {},
        summary: [{ label: t("Liquid funds today"), value: r.opening / 100 }],
        tables: [
          {
            columns: [col("Week starting", "date"), col("Expected receipts", "money"), col("Expected payments", "money"), col("Projected balance", "money")],
            rows: [
              { cells: [t("Liquid funds today"), null, null, major(r.opening)], style: "total" },
              ...r.weeks.map((w) => ({ cells: [w.week, major(w.receipts), major(-w.payments), major(w.balance)] })),
            ],
          },
        ],
      };
    }
    case "salaries": {
      const y = query.year ?? Number(year);
      const rows = await salarySummary(ctx, y);
      return {
        ...base,
        subtitle: String(y),
        query: { year: String(y) },
        tables: [
          {
            columns: [col("Employee"), col("AHV number", "code"), col("Months", "number"), col("Gross", "money"), col("AHV/ALV", "money"), col("BVG", "money"), col("Withholding tax", "money"), col("Net", "money"), col("Employer cost", "money")],
            rows: rows.map((r) => ({
              cells: [`${r.firstname} ${r.lastname}`, (r.ahv_number as string) ?? null, Number(r.months), major(Number(r.gross)), major(Number(r.social)), major(Number(r.bvg)), major(Number(r.withholding_tax)), major(Number(r.net)), major(Number(r.employer_cost))],
              link: { resource: "employees", id: Number(r.id) },
            })),
          },
        ],
      };
    }
  }
  throw new AppError("not_found", "Unknown report {name}.", undefined, { name: id });
}

const SHEET_TYPE: Record<ColumnType, CellType> = { text: "string", code: "string", date: "date", number: "number", money: "money" };

/** The same tables as spreadsheet sheets. */
export function reportSheets(view: ReportView, company: string): Sheet[] {
  return view.tables.map((table, i) => ({
    name: (table.title ?? view.title).slice(0, 31) || `Sheet ${i + 1}`,
    title: [`${view.title} — ${company}`, view.subtitle],
    columns: table.columns.map((c) => ({ header: c.label, type: SHEET_TYPE[c.type], width: c.type === "text" ? 40 : undefined })),
    rows: table.rows.map((r) => ({
      cells: r.cells.map((c, j) => (j === 1 && r.indent ? `${"    ".repeat(r.indent)}${c ?? ""}` : c)),
      bold: r.style === "total" || r.style === "section",
    })),
  }));
}
