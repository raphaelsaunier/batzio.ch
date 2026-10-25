import type { Metadata } from "next";
import Link from "next/link";
import { PaymentExportForm, StatementImportForm } from "@/components/banking/import-form";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAmount, formatDate } from "@/lib/format";
import { assertCan } from "@/lib/server/ctx";
import { tenantCtx } from "@/lib/server/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Import & export") };
}

export default async function BankImportPage({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await getT();
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  assertCan(ctx, "banking", "write");
  const banks = await ctx.db.all<{ id: number; name: string; iban: string | null; open: number }>(
    `SELECT b.id, b.name, b.iban, (SELECT COUNT(*) FROM outgoing_payments o WHERE o.bank_account_id = b.id AND o.status = 'open') AS open
     FROM bank_accounts b ORDER BY b.is_default DESC, b.name`,
  );
  const stats = await ctx.db.first<{ unmatched: number; suggested: number; last: string | null }>(
    `SELECT SUM(status = 'unmatched') AS unmatched, SUM(status = 'suggested') AS suggested, MAX(booking_date) AS last FROM bank_transactions`,
  );
  const openPayments = await ctx.db.all<{ id: number; recipient_name: string | null; amount: number; execution_date: string }>(
    "SELECT id, recipient_name, amount, execution_date FROM outgoing_payments WHERE status = 'open' ORDER BY execution_date LIMIT 8",
  );
  return (
    <>
      <PageHeader
        title="Bank import & payments"
        description={t("Reconcile statements and pay suppliers via ISO 20022 files.")}
        crumbs={[{ label: t("Banking") }, { label: t("Import & export") }]}
      />
      <PageBody>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle>{t("Import bank statement")}</CardTitle>
              <CardDescription>
                {t("Duplicates are skipped. Incoming payments are matched by QR reference, invoice number or amount.")}
                {stats?.last ? ` ${t("Last booking date imported: {date}.", { date: formatDate(stats.last) })}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatementImportForm tenant={tenant} banks={banks} />
              {(stats?.unmatched || stats?.suggested) ? (
                <p className="text-sm">
                  <Link className="text-primary hover:underline" href={`/${tenant}/bank_transactions?status=suggested`}>
                    {t("{n} matches to confirm", { n: stats.suggested ?? 0 })}
                  </Link>{" "}
                  ·{" "}
                  <Link className="text-primary hover:underline" href={`/${tenant}/bank_transactions?status=unmatched`}>
                    {t("{n} lines need a home", { n: stats.unmatched ?? 0 })}
                  </Link>
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card id="pain001" className="shadow-xs">
            <CardHeader>
              <CardTitle>{t("Export payment file (pain.001)")}</CardTitle>
              <CardDescription>{t("Creates a Swiss Payment Standards credit transfer file for all open outgoing payments of an account.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <PaymentExportForm tenant={tenant} banks={banks} />
              <div className="divide-y rounded-lg border">
                {openPayments.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t("No open payments. Schedule payments from booked supplier bills.")}</p>}
                {openPayments.map((p) => (
                  <Link key={p.id} href={`/${tenant}/outgoing_payments/${p.id}`} className="flex justify-between px-3 py-2 text-sm hover:bg-muted/50">
                    <span>
                      {p.recipient_name} <span className="text-muted-foreground">· {formatDate(p.execution_date)}</span>
                    </span>
                    <span className="num">{formatAmount(p.amount)}</span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
