import { formatDate } from "@batzio/core/format";
import { getResource } from "./resources/registry";
import type { FieldDef, ResourceDef, Row } from "./resources/types";
import { VAT_FORM_DIGITS } from "@batzio/core/swiss/vat";
import type { accountLedger, Report, trialBalance, vatReport } from "./accounting";
import { parseJsonArray, refLabels } from "./crud";
import type { Ctx } from "./ctx";
import type { CellType, Sheet } from "./xlsx";

const TYPE_MAP: Partial<Record<FieldDef["type"], CellType>> = {
  money: "money",
  decimal: "number",
  percent: "number",
  int: "integer",
  date: "date",
  boolean: "boolean",
};

/** Converts records into a spreadsheet with readable labels and typed cells. */
export async function resourceSheet(ctx: Ctx, res: ResourceDef, rows: Row[]): Promise<Sheet> {
  const fields = res.fields.filter((f) => (!f.hidden || f.name === "id") && f.type !== "json");
  const labels = await refLabels(ctx, res, rows, getResource);
  return {
    name: res.labelPlural,
    title: [`${res.labelPlural} — ${ctx.tenant.name}`, `Exported ${formatDate(new Date().toISOString().slice(0, 10))}`],
    columns: fields.map((f) => ({ header: f.label, type: f.type === "int" && f.ref ? "string" : (TYPE_MAP[f.type] ?? "string") })),
    rows: rows.map((row) =>
      fields.map((f) => {
        const v = row[f.name];
        if (v === null || v === undefined) return null;
        switch (f.type) {
          case "money":
            return Number(v) / 100;
          case "boolean":
            return Boolean(Number(v));
          case "ref":
            return labels[f.name]?.[String(v)] ?? `#${v}`;
          case "tags":
            return parseJsonArray<number>(v)
              .map((id) => labels[f.name]?.[String(id)] ?? `#${id}`)
              .join(", ");
          case "enum":
            return f.options?.find((o) => o.value === v)?.label ?? String(v);
          case "decimal":
          case "percent":
          case "int":
            return Number(v);
          default:
            return String(v);
        }
      }),
    ),
  };
}

const m = (cents: number) => cents / 100;

export function reportSheet(report: Report, company: string): Sheet {
  const rows: Sheet["rows"] = [];
  for (const section of report.sections) {
    rows.push({ cells: [null, section.title, null], bold: true });
    for (const line of section.lines) {
      rows.push({
        cells: [line.number ?? null, `${"    ".repeat(line.level)}${line.label}`, m(line.amount)],
        bold: line.kind !== "account",
      });
    }
    rows.push([null, null, null]);
  }
  if (report.result) rows.push({ cells: [null, report.result.label, m(report.result.amount)], bold: true });
  const period = report.period.from ? `${formatDate(report.period.from)} – ${formatDate(report.period.to)}` : `as of ${formatDate(report.period.to)}`;
  return {
    name: report.title,
    title: [`${report.title} — ${company}`, period],
    columns: [
      { header: "Account", width: 10 },
      { header: "Description", width: 52 },
      { header: "Amount CHF", type: "money", width: 16 },
    ],
    rows,
  };
}

export function trialBalanceSheet(tb: Awaited<ReturnType<typeof trialBalance>>, company: string): Sheet {
  return {
    name: "Trial balance",
    title: [`Trial balance — ${company}`, `${formatDate(tb.period.from)} – ${formatDate(tb.period.to)}`],
    columns: [
      { header: "Account", width: 10 },
      { header: "Name", width: 44 },
      { header: "Type", width: 12 },
      { header: "Opening", type: "money" },
      { header: "Debit", type: "money" },
      { header: "Credit", type: "money" },
      { header: "Balance", type: "money" },
    ],
    rows: [
      ...tb.rows.map((r) => [r.number, r.name, r.type, m(r.opening), m(r.debit), m(r.credit), m(r.balance)]),
      { cells: [null, "Total", null, null, m(tb.totals.debit), m(tb.totals.credit), null], bold: true },
    ],
  };
}

export function ledgerSheet(l: Awaited<ReturnType<typeof accountLedger>>, company: string): Sheet {
  return {
    name: `Ledger ${l.account.number}`,
    title: [`Account ${l.account.number} ${l.account.name} — ${company}`, `${formatDate(l.period.from)} – ${formatDate(l.period.to)}`],
    columns: [
      { header: "Date", type: "date", width: 12 },
      { header: "Reference", width: 14 },
      { header: "Description", width: 44 },
      { header: "Contra account", width: 30 },
      { header: "VAT", width: 8 },
      { header: "Debit", type: "money" },
      { header: "Credit", type: "money" },
      { header: "Balance", type: "money" },
    ],
    rows: [
      { cells: [null, null, "Opening balance", null, null, null, null, m(l.opening)], bold: true },
      ...l.rows.map((r) => [r.date, r.ref_nr, r.description, r.contra, r.tax_code, r.debit ? m(r.debit) : null, r.credit ? m(r.credit) : null, m(r.balance)]),
      { cells: [null, null, "Closing balance", null, null, m(l.totals.debit), m(l.totals.credit), m(l.closing)], bold: true },
    ],
  };
}

export function vatSheets(v: Awaited<ReturnType<typeof vatReport>>, company: string): Sheet[] {
  const period = `${formatDate(v.period.from)} – ${formatDate(v.period.to)}`;
  const digits = v.digits as Record<string, number>;
  return [
    {
      name: "VAT return",
      title: [`VAT return (effective method) — ${company}`, period],
      columns: [
        { header: "Digit", width: 8 },
        { header: "Description", width: 56 },
        { header: "Turnover / base", type: "money" },
        { header: "Tax", type: "money" },
      ],
      rows: [
        ["200", VAT_FORM_DIGITS["200"], m(digits["200"]), null],
        ["221", VAT_FORM_DIGITS["221"], m(digits["221"]), null],
        ["230", VAT_FORM_DIGITS["230"], m(digits["230"]), null],
        ["289", VAT_FORM_DIGITS["289"], m(digits["289"]), null],
        { cells: ["299", VAT_FORM_DIGITS["299"], m(digits["299"]), null], bold: true },
        ["303", VAT_FORM_DIGITS["303"], m(digits["303"]), m(digits["303_tax"])],
        ["313", VAT_FORM_DIGITS["313"], m(digits["313"]), m(digits["313_tax"])],
        ["343", VAT_FORM_DIGITS["343"], m(digits["343"]), m(digits["343_tax"])],
        { cells: ["399", VAT_FORM_DIGITS["399"], null, m(digits["399"])], bold: true },
        ["400", VAT_FORM_DIGITS["400"], null, m(digits["400"])],
        ["405", VAT_FORM_DIGITS["405"], null, m(digits["405"])],
        { cells: ["479", VAT_FORM_DIGITS["479"], null, m(digits["479"])], bold: true },
        { cells: ["500", VAT_FORM_DIGITS["500"], null, m(digits["500"])], bold: true },
        { cells: ["510", VAT_FORM_DIGITS["510"], null, m(digits["510"])], bold: true },
      ],
    },
    {
      name: "By VAT code",
      title: [`VAT by code — ${company}`, period],
      columns: [
        { header: "Code", width: 8 },
        { header: "Name", width: 40 },
        { header: "Rate %", type: "number" },
        { header: "Digit", width: 8 },
        { header: "Base", type: "money" },
        { header: "Tax", type: "money" },
      ],
      rows: v.lines.map((l) => [l.code, l.name, l.rate, l.digit, m(l.base), m(l.tax)]),
    },
  ];
}
