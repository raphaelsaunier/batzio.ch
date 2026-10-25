import { BookOpen, CalendarClock, FileSpreadsheet, HandCoins, Landmark, NotebookPen, Percent, Scale, TrendingUp, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Term } from "@/components/i18n/term";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getT } from "@/lib/i18n/server";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canCtx } from "@/lib/server/ctx";
import { tenantCtx } from "@/lib/server/session";
import { N_ } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Insights") };
}

const REPORTS = [
  { id: "balance-sheet", title: N_("Balance sheet"), text: N_("Assets, liabilities and equity as of a date, structured by the SME chart of accounts."), icon: Scale, area: "accounting" },
  { id: "income-statement", title: N_("Income statement"), text: N_("Staged profit and loss: gross profit, EBITDA, EBIT and net result."), icon: TrendingUp, area: "accounting" },
  { id: "trial-balance", title: N_("Trial balance"), text: N_("Opening balance, debit, credit and closing balance of every account."), icon: FileSpreadsheet, area: "accounting" },
  { id: "vat", title: N_("VAT return"), text: N_("Figures for the ESTV VAT return (effective method) by form digit and VAT code."), icon: Percent, area: "accounting" },
  { id: "ledger", title: N_("Account ledger"), text: N_("All postings of an account with contra account and running balance."), icon: BookOpen, area: "accounting" },
  { id: "journal", title: N_("Journal"), text: N_("Chronological list of all bookings with their debit/credit lines."), icon: NotebookPen, area: "accounting" },
  { id: "receivables", title: N_("Open receivables"), text: N_("Unpaid customer invoices with ageing buckets."), icon: HandCoins, area: "sales" },
  { id: "payables", title: N_("Open payables"), text: N_("Unpaid supplier bills with due dates and ageing."), icon: CalendarClock, area: "purchases" },
  { id: "liquidity", title: N_("Liquidity forecast"), text: N_("Bank balance plus expected receipts and payments by week."), icon: Landmark, area: "banking" },
  { id: "salaries", title: N_("Salary summary"), text: N_("Annual payroll totals per employee as basis for salary certificates."), icon: Users, area: "payroll" },
] as const;

export default async function ReportsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  const t = await getT();
  return (
    <>
      <PageHeader title={t("Insights")} description={t("How the business is doing, in numbers. Every report exports to PDF and Excel — hover the jargon for plain words.")} />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {REPORTS.filter((r) => canCtx(ctx, r.area, "read")).map((r) => (
            <Link key={r.id} href={`/${tenant}/reports/${r.id}`}>
              <Card className="h-full gap-3 shadow-xs transition-shadow hover:shadow-md">
                <CardHeader className="flex flex-row items-start gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-metal text-white">
                    <r.icon className="size-5" />
                  </span>
                  <div className="space-y-1">
                    <CardTitle className="font-display">
                      <Term label={r.title}>{t(r.title)}</Term>
                    </CardTitle>
                    <CardDescription>{t(r.text)}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </PageBody>
    </>
  );
}
