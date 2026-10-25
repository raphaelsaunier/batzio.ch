import { CheckCircle2, FileDown, Sheet, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountPicker } from "@/components/reports/account-picker";
import { PeriodPicker } from "@/components/reports/period-picker";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAmount, formatDate, today } from "@/lib/format";
import { accountLedger, balanceSheet, incomeStatement, trialBalance, vatReport, type Report } from "@/lib/server/accounting";
import { assertCan } from "@/lib/server/ctx";
import { liquidityForecast, openItems } from "@/lib/server/dashboard";
import { salarySummary } from "@/lib/server/payroll";
import { tenantCtx } from "@/lib/server/session";
import { VAT_FORM_DIGITS } from "@/lib/swiss/vat";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { Term } from "@/components/i18n/term";
import { N_ } from "@/lib/i18n";

type Params = { tenant: string; report: string };
type Search = Record<string, string | undefined>;

const TITLES: Record<string, string> = {
  "balance-sheet": N_("Balance sheet"),
  "income-statement": N_("Income statement"),
  "trial-balance": N_("Trial balance"),
  vat: N_("VAT return"),
  ledger: N_("Account ledger"),
  journal: N_("Journal"),
  receivables: N_("Open receivables"),
  payables: N_("Open payables"),
  liquidity: N_("Liquidity forecast"),
  salaries: N_("Salary summary"),
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { report } = await params;
  return { title: (await getT())(TITLES[report] ?? "Report") };
}

const Num = ({ v, strong, className }: { v: number; strong?: boolean; className?: string }) => (
  <span className={cn("num", strong && "font-semibold", v < 0 && "text-destructive", className)}>{formatAmount(v)}</span>
);

function Exports({ href }: { href: string }) {
  return (
    <>
      <Button variant="outline" asChild>
        <a href={`${href}&format=pdf`} target="_blank" rel="noreferrer">
          <FileDown /> PDF
        </a>
      </Button>
      <Button variant="outline" asChild>
        <a href={`${href}&format=xlsx`}>
          <Sheet /> Excel
        </a>
      </Button>
    </>
  );
}

async function StatementView({ report, tenant }: { report: Report; tenant: string }) {
  const t = await getT();
  return (
    <div className="space-y-4">
      {report.sections.map((s) => (
        <Card key={s.title} className="gap-0 overflow-hidden py-0 shadow-xs">
          <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5">
            <span className="text-sm font-semibold">
              <Term label={s.title}>{t(s.title)}</Term>
            </span>
            <Num v={s.total} strong />
          </div>
          <div className="divide-y">
            {s.lines.map((l, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-between gap-4 px-4 py-1.5 text-sm",
                  l.kind !== "account" && "font-semibold",
                  (l.kind === "result" || l.kind === "total") && "bg-accent/40",
                )}
                style={{ paddingLeft: `${1 + l.level * 1.25}rem` }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  {l.number && <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{l.number}</span>}
                  {l.accountId ? (
                    <Link className="truncate hover:text-primary hover:underline" href={`/${tenant}/reports/ledger?account=${l.accountId}&from=${report.period.from ?? `${report.period.to.slice(0, 4)}-01-01`}&to=${report.period.to}`}>
                      {l.label}
                    </Link>
                  ) : (
                    <span className="truncate">
                      <Term label={l.label}>{t(l.label)}</Term>
                    </span>
                  )}
                </span>
                <Num v={l.amount} strong={l.kind !== "account"} />
              </div>
            ))}
          </div>
        </Card>
      ))}
      {report.result && (
        <div className="flex items-center justify-between rounded-xl bg-metal px-5 py-3 text-white">
          <span className="font-semibold">
            <Term label={report.result.label}>{t(report.result.label)}</Term>
          </span>
          <span className="text-lg font-semibold num">CHF {formatAmount(report.result.amount)}</span>
        </div>
      )}
    </div>
  );
}

export default async function ReportPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const t = await getT();
  const { tenant, report } = await params;
  const search = await searchParams;
  if (!TITLES[report]) notFound();
  const ctx = await tenantCtx(tenant);
  const year = today().slice(0, 4);
  const from = search.from ?? `${year}-01-01`;
  const to = search.to ?? `${year}-12-31`;
  const api = (path: string, extra = "") => `/api/v1/reports/${path}?tenant=${tenant}${extra}`;
  const crumbs = [{ label: t("Insights"), href: `/${tenant}/reports` }, { label: t(TITLES[report]) }];

  let content: React.ReactNode = null;
  let actions: React.ReactNode = null;
  let filters: React.ReactNode = <PeriodPicker from={from} to={to} />;

  switch (report) {
    case "balance-sheet": {
      assertCan(ctx, "accounting", "read");
      const date = search.date ?? today();
      const r = await balanceSheet(ctx, date);
      filters = <PeriodPicker mode="date" to={date} />;
      actions = <Exports href={api("balance-sheet", `&date=${date}`)} />;
      content = (
        <>
          <div className="flex items-center gap-2 text-sm">
            {r.balanced ? (
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                <CheckCircle2 /> {t("Balanced")}
              </Badge>
            ) : (
              <Badge variant="destructive">
                <TriangleAlert /> {t("Not balanced")}
              </Badge>
            )}
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <StatementView report={{ ...r, sections: r.sections.slice(0, 1), result: undefined }} tenant={tenant} />
            <StatementView report={{ ...r, sections: r.sections.slice(1) }} tenant={tenant} />
          </div>
        </>
      );
      break;
    }
    case "income-statement": {
      assertCan(ctx, "accounting", "read");
      const r = await incomeStatement(ctx, from, to);
      actions = <Exports href={api("income-statement", `&from=${from}&to=${to}`)} />;
      content = <StatementView report={r} tenant={tenant} />;
      break;
    }
    case "trial-balance": {
      assertCan(ctx, "accounting", "read");
      const r = await trialBalance(ctx, from, to);
      actions = <Exports href={api("trial-balance", `&from=${from}&to=${to}`)} />;
      content = (
        <Card className="overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead><Term label="Account">{t("Account")}</Term></TableHead>
                <TableHead><Term label="Name">{t("Name")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Opening">{t("Opening")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Debit">{t("Debit")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Credit">{t("Credit")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Balance">{t("Balance")}</Term></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.number}</TableCell>
                  <TableCell>
                    <Link className="hover:text-primary hover:underline" href={`/${tenant}/reports/ledger?account=${row.id}&from=${from}&to=${to}`}>
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right"><Num v={row.opening} /></TableCell>
                  <TableCell className="text-right"><Num v={row.debit} /></TableCell>
                  <TableCell className="text-right"><Num v={row.credit} /></TableCell>
                  <TableCell className="text-right"><Num v={row.balance} strong /></TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-semibold">{t("Total")}</TableCell>
                <TableCell className="text-right"><Num v={r.totals.debit} strong /></TableCell>
                <TableCell className="text-right"><Num v={r.totals.credit} strong /></TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </Card>
      );
      break;
    }
    case "vat": {
      assertCan(ctx, "accounting", "read");
      const r = await vatReport(ctx, from, to);
      const d = r.digits as Record<string, number>;
      const row = (digit: string, base: number | null, tax: number | null, strong = false) => (
        <TableRow key={digit} className={cn(strong && "bg-accent/40 font-semibold")}>
          <TableCell className="font-mono">{digit}</TableCell>
          <TableCell>{VAT_FORM_DIGITS[digit]}</TableCell>
          <TableCell className="text-right">{base !== null && <Num v={base} strong={strong} />}</TableCell>
          <TableCell className="text-right">{tax !== null && <Num v={tax} strong={strong} />}</TableCell>
        </TableRow>
      );
      actions = <Exports href={api("vat", `&from=${from}&to=${to}`)} />;
      content = (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card className="overflow-hidden py-0 shadow-xs">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-16"><Term label="Digit">{t("Digit")}</Term></TableHead>
                  <TableHead><Term label="Description">{t("Description")}</Term></TableHead>
                  <TableHead className="text-right"><Term label="Turnover / base">{t("Turnover / base")}</Term></TableHead>
                  <TableHead className="text-right"><Term label="Tax">{t("Tax")}</Term></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row("200", d["200"], null)}
                {row("221", d["221"], null)}
                {row("230", d["230"], null)}
                {row("289", d["289"], null)}
                {row("299", d["299"], null, true)}
                {row("303", d["303"], d["303_tax"])}
                {row("313", d["313"], d["313_tax"])}
                {row("343", d["343"], d["343_tax"])}
                {row("399", null, d["399"], true)}
                {row("400", null, d["400"])}
                {row("405", null, d["405"])}
                {row("479", null, d["479"], true)}
                {row("500", null, d["500"], true)}
                {row("510", null, d["510"], true)}
              </TableBody>
            </Table>
          </Card>
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle>{t("By VAT code")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {r.lines.length === 0 && <p className="text-sm text-muted-foreground">{t("No VAT postings in this period.")}</p>}
              {r.lines.map((l) => (
                <div key={l.tax_id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-mono text-xs">{l.code}</span> <span className="text-muted-foreground">{l.name}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Num v={l.tax} strong /> <span className="text-xs text-muted-foreground">on {formatAmount(l.base)}</span>
                  </span>
                </div>
              ))}
              <div className="mt-3 border-t pt-3">
                <div className="flex justify-between text-sm font-semibold">
                  <span>{r.totals.payable >= 0 ? t("VAT payable") : t("VAT credit")}</span>
                  <Num v={Math.abs(r.totals.payable)} strong />
                </div>
              </div>
              <p className="pt-2 text-xs text-muted-foreground">
                Book the settlement and mark the return as submitted under{" "}
                <Link className="text-primary hover:underline" href={`/${tenant}/vat_periods`}>
                  {t("VAT periods")}
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      );
      break;
    }
    case "ledger": {
      assertCan(ctx, "accounting", "read");
      const accountId = Number(search.account) || (await ctx.db.value<number>("SELECT id FROM accounts WHERE number = '1020'"));
      const account = accountId ? await ctx.db.first<{ id: number; number: string; name: string }>("SELECT id, number, name FROM accounts WHERE id = ?", accountId) : null;
      filters = (
        <div className="flex flex-wrap items-center gap-2">
          <AccountPicker tenant={tenant} accountId={account?.id ?? null} label={account ? `${account.number} ${account.name}` : null} />
          <PeriodPicker from={from} to={to} />
        </div>
      );
      if (account) {
        const r = await accountLedger(ctx, account.id, from, to);
        actions = <Exports href={api("ledger", `&account_id=${account.id}&from=${from}&to=${to}`)} />;
        content = (
          <Card className="overflow-hidden py-0 shadow-xs">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead><Term label="Date">{t("Date")}</Term></TableHead>
                  <TableHead><Term label="Reference">{t("Reference")}</Term></TableHead>
                  <TableHead><Term label="Description">{t("Description")}</Term></TableHead>
                  <TableHead><Term label="Contra account">{t("Contra account")}</Term></TableHead>
                  <TableHead><Term label="VAT">{t("VAT")}</Term></TableHead>
                  <TableHead className="text-right"><Term label="Debit">{t("Debit")}</Term></TableHead>
                  <TableHead className="text-right"><Term label="Credit">{t("Credit")}</Term></TableHead>
                  <TableHead className="text-right"><Term label="Balance">{t("Balance")}</Term></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-accent/30 font-medium">
                  <TableCell colSpan={7}>{t("Opening balance")}</TableCell>
                  <TableCell className="text-right"><Num v={r.opening} strong /></TableCell>
                </TableRow>
                {r.rows.map((row) => (
                  <TableRow key={row.posting_id}>
                    <TableCell className="num whitespace-nowrap">{formatDate(row.date)}</TableCell>
                    <TableCell>
                      <Link className="font-mono text-xs hover:text-primary hover:underline" href={`/${tenant}/journal_entries/${row.entry_id}`}>
                        {row.ref_nr}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{row.description}</TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{row.contra}</TableCell>
                    <TableCell className="font-mono text-xs">{row.tax_code}</TableCell>
                    <TableCell className="text-right">{row.debit ? <Num v={row.debit} /> : null}</TableCell>
                    <TableCell className="text-right">{row.credit ? <Num v={row.credit} /> : null}</TableCell>
                    <TableCell className="text-right"><Num v={row.balance} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="font-semibold">{t("Closing balance")}</TableCell>
                  <TableCell className="text-right"><Num v={r.totals.debit} strong /></TableCell>
                  <TableCell className="text-right"><Num v={r.totals.credit} strong /></TableCell>
                  <TableCell className="text-right"><Num v={r.closing} strong /></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
        );
      }
      break;
    }
    case "journal": {
      assertCan(ctx, "accounting", "read");
      const entries = await ctx.db.all<{ id: number; ref_nr: string; date: string; description: string; type: string; total: number }>(
        "SELECT id, ref_nr, date, description, type, total FROM journal_entries WHERE date BETWEEN ? AND ? ORDER BY date, id LIMIT 500",
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
      actions = (
        <Button variant="outline" asChild>
          <a href={`/api/v1/journal_entries?format=xlsx&tenant=${tenant}&date_gte=${from}&date_lte=${to}`}>
            <Sheet /> Excel
          </a>
        </Button>
      );
      content = (
        <Card className="overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead><Term label="Date">{t("Date")}</Term></TableHead>
                <TableHead><Term label="Ref.">{t("Ref.")}</Term></TableHead>
                <TableHead><Term label="Description">{t("Description")}</Term></TableHead>
                <TableHead><Term label="Debit">{t("Debit")}</Term></TableHead>
                <TableHead><Term label="Credit">{t("Credit")}</Term></TableHead>
                <TableHead><Term label="VAT">{t("VAT")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Amount">{t("Amount")}</Term></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.flatMap((e) =>
                lines
                  .filter((l) => l.entry_id === e.id)
                  .map((l, i) => (
                    <TableRow key={`${e.id}-${i}`} className={cn(i === 0 && "border-t-2")}>
                      <TableCell className="num whitespace-nowrap">{i === 0 ? formatDate(e.date) : ""}</TableCell>
                      <TableCell>
                        {i === 0 && (
                          <Link className="font-mono text-xs hover:text-primary hover:underline" href={`/${tenant}/journal_entries/${e.id}`}>
                            {e.ref_nr}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="max-w-72 truncate">{i === 0 ? e.description : <span className="text-muted-foreground">{l.description}</span>}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs">{l.debit}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs">{l.credit}</TableCell>
                      <TableCell className="font-mono text-xs">{l.tax}</TableCell>
                      <TableCell className="text-right"><Num v={l.amount} /></TableCell>
                    </TableRow>
                  )),
              )}
            </TableBody>
          </Table>
        </Card>
      );
      break;
    }
    case "receivables":
    case "payables": {
      const type = report;
      assertCan(ctx, type === "receivables" ? "sales" : "purchases", "read");
      const r = await openItems(ctx, type);
      filters = null;
      actions = (
        <Button variant="outline" asChild>
          <a href={`/api/v1/${type === "receivables" ? "invoices" : "bills"}?format=xlsx&tenant=${tenant}&status_in=${type === "receivables" ? "open,partial" : "booked,partial"}`}>
            <Sheet /> Excel
          </a>
        </Button>
      );
      content = (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            {(Object.entries(r.buckets) as [string, number][]).map(([bucket, amount]) => (
              <Card key={bucket} className="gap-1 py-3 shadow-xs">
                <CardContent className="px-4">
                  <div className="text-xs text-muted-foreground uppercase">{bucket === "current" ? t("Not yet due") : t("{range} days", { range: bucket })}</div>
                  <div className={cn("text-lg font-semibold num", bucket !== "current" && amount > 0 && "text-destructive")}>{formatAmount(amount)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="overflow-hidden py-0 shadow-xs">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead><Term label="Number">{t("Number")}</Term></TableHead>
                  <TableHead>{type === "receivables" ? t("Customer") : t("Supplier")}</TableHead>
                  <TableHead><Term label="Date">{t("Date")}</Term></TableHead>
                  <TableHead><Term label="Due">{t("Due")}</Term></TableHead>
                  <TableHead className="text-right"><Term label="Days overdue">{t("Days overdue")}</Term></TableHead>
                  <TableHead className="text-right"><Term label="Total">{t("Total")}</Term></TableHead>
                  <TableHead className="text-right"><Term label="Open">{t("Open")}</Term></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link className="font-mono text-xs hover:text-primary hover:underline" href={`/${tenant}/${type === "receivables" ? "invoices" : "bills"}/${i.id}`}>
                        {i.nr}
                      </Link>
                    </TableCell>
                    <TableCell>{i.contact}</TableCell>
                    <TableCell className="num">{formatDate(i.date)}</TableCell>
                    <TableCell className="num">{formatDate(i.due_date)}</TableCell>
                    <TableCell className={cn("text-right num", i.days_overdue > 0 && "text-destructive")}>{i.days_overdue || "—"}</TableCell>
                    <TableCell className="text-right"><Num v={i.total} /></TableCell>
                    <TableCell className="text-right"><Num v={i.open} strong /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      );
      break;
    }
    case "liquidity": {
      assertCan(ctx, "banking", "read");
      const r = await liquidityForecast(ctx);
      filters = null;
      content = (
        <Card className="overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead><Term label="Week starting">{t("Week starting")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Expected receipts">{t("Expected receipts")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Expected payments">{t("Expected payments")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Projected balance">{t("Projected balance")}</Term></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-accent/30 font-medium">
                <TableCell colSpan={3}>{t("Liquid funds today")}</TableCell>
                <TableCell className="text-right"><Num v={r.opening} strong /></TableCell>
              </TableRow>
              {r.weeks.map((w) => (
                <TableRow key={w.week}>
                  <TableCell className="num">{formatDate(w.week)}</TableCell>
                  <TableCell className="text-right text-success"><Num v={w.receipts} /></TableCell>
                  <TableCell className="text-right"><Num v={-w.payments} /></TableCell>
                  <TableCell className="text-right"><Num v={w.balance} strong /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      );
      break;
    }
    case "salaries": {
      assertCan(ctx, "payroll", "read");
      const y = Number(search.year ?? year);
      const rows = await salarySummary(ctx, y);
      filters = (
        <div className="flex gap-1">
          {[y - 1, y, y + 1].map((v) => (
            <Button key={v} variant={v === y ? "default" : "outline"} size="sm" asChild>
              <Link href={`?year=${v}`}>{v}</Link>
            </Button>
          ))}
        </div>
      );
      content = (
        <Card className="overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead><Term label="Employee">{t("Employee")}</Term></TableHead>
                <TableHead><Term label="AHV number">{t("AHV number")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Months">{t("Months")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Gross">{t("Gross")}</Term></TableHead>
                <TableHead className="text-right"><Term label="AHV/ALV">{t("AHV/ALV")}</Term></TableHead>
                <TableHead className="text-right"><Term label="BVG">{t("BVG")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Withholding tax">{t("Withholding tax")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Net">{t("Net")}</Term></TableHead>
                <TableHead className="text-right"><Term label="Employer cost">{t("Employer cost")}</Term></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    No finalised payslips in {y}.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={String(r.id)}>
                  <TableCell>
                    <Link className="hover:text-primary hover:underline" href={`/${tenant}/employees/${r.id}`}>
                      {String(r.firstname)} {String(r.lastname)}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{String(r.ahv_number ?? "")}</TableCell>
                  <TableCell className="text-right num">{String(r.months)}</TableCell>
                  <TableCell className="text-right"><Num v={Number(r.gross)} /></TableCell>
                  <TableCell className="text-right"><Num v={Number(r.social)} /></TableCell>
                  <TableCell className="text-right"><Num v={Number(r.bvg)} /></TableCell>
                  <TableCell className="text-right"><Num v={Number(r.withholding_tax)} /></TableCell>
                  <TableCell className="text-right"><Num v={Number(r.net)} strong /></TableCell>
                  <TableCell className="text-right"><Num v={Number(r.employer_cost)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      );
      break;
    }
  }

  const period =
    report === "balance-sheet" ? t("As of {date}", { date: formatDate(search.date ?? today()) }) : filters ? `${formatDate(from)} – ${formatDate(to)}` : t("As of {date}", { date: formatDate(today()) });

  return (
    <>
      <PageHeader title={<Term label={TITLES[report]}>{t(TITLES[report])}</Term>} description={`${ctx.tenant.name} · ${period}`} crumbs={crumbs} actions={actions} />
      <PageBody className="space-y-4">
        {filters && <div className="flex flex-wrap items-center gap-3">{filters}</div>}
        {content}
        <p className="text-xs text-muted-foreground">{t("Amounts in CHF.")}</p>
      </PageBody>
    </>
  );
}
