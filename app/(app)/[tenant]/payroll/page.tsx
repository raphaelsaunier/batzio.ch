import type { Metadata } from "next";
import Link from "next/link";
import { PayrollRunForm } from "@/components/payroll-run";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_PAYROLL_RATES } from "@/lib/calc/payroll";
import { formatAmount, formatDecimal } from "@/lib/format";
import { assertCan } from "@/lib/server/ctx";
import { tenantCtx } from "@/lib/server/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Payroll") };
}

export default async function PayrollPage({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await getT();
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  assertCan(ctx, "payroll", "read");
  const now = new Date();
  const runs = await ctx.db.all<{ year: number; month: number; count: number; gross: number; net: number; employer: number; drafts: number }>(
    `SELECT year, month, COUNT(*) AS count, SUM(gross) AS gross, SUM(net) AS net, SUM(employer_cost) AS employer, SUM(status = 'draft') AS drafts
     FROM payslips GROUP BY year, month ORDER BY year DESC, month DESC LIMIT 24`,
  );
  const r = DEFAULT_PAYROLL_RATES;
  return (
    <>
      <PageHeader title={t("Payroll")} description={t("Monthly payroll runs with Swiss social insurance deductions.")} />
      <PageBody>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle>{t("New payroll run")}</CardTitle>
              <CardDescription>{t("Creates draft payslips for all active employees. Review, then finalise to book them.")}</CardDescription>
            </CardHeader>
            <CardContent>
              <PayrollRunForm tenant={tenant} year={now.getUTCFullYear()} month={now.getUTCMonth() + 1} />
            </CardContent>
          </Card>
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle>{t("Rates applied")}</CardTitle>
              <CardDescription>{t("Employee shares; employer pays matching AHV/ALV plus FAK and accident insurance.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span>AHV/IV/EO</span><span className="num">{formatDecimal(r.ahv, 2)}%</span></div>
              <div className="flex justify-between"><span>{t("ALV (up to CHF 148’200 a year)")}</span><span className="num">{formatDecimal(r.alv, 2)}%</span></div>
              <div className="flex justify-between"><span>{t("FAK (employer)")}</span><span className="num">{formatDecimal(r.fak, 2)}%</span></div>
              <div className="flex justify-between"><span>{t("UVG BU (employer)")}</span><span className="num">{formatDecimal(r.uvgBu, 2)}%</span></div>
              <p className="pt-2 text-xs text-muted-foreground">{t("BVG, NBU, KTG and withholding tax rates are set per employee.")}</p>
            </CardContent>
          </Card>
        </div>
        <Card className="overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("Period")}</TableHead>
                <TableHead className="text-right">{t("Payslips")}</TableHead>
                <TableHead className="text-right">{t("Gross")}</TableHead>
                <TableHead className="text-right">{t("Net")}</TableHead>
                <TableHead className="text-right">{t("Employer cost")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">{t("No payroll runs yet.")}</TableCell>
                </TableRow>
              )}
              {runs.map((run) => (
                <TableRow key={`${run.year}-${run.month}`}>
                  <TableCell>
                    <Link className="hover:text-primary hover:underline" href={`/${tenant}/payslips?year=${run.year}&month=${run.month}`}>
                      {String(run.month).padStart(2, "0")}/{run.year}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right num">{run.count}</TableCell>
                  <TableCell className="text-right num">{formatAmount(run.gross)}</TableCell>
                  <TableCell className="text-right num">{formatAmount(run.net)}</TableCell>
                  <TableCell className="text-right num">{formatAmount(run.employer)}</TableCell>
                  <TableCell className="text-sm">{run.drafts ? t("{n} draft", { n: run.drafts }) : t("Finalised")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </PageBody>
    </>
  );
}
