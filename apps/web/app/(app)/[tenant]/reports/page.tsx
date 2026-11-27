import type { Metadata } from "next";
import Link from "next/link";
import { Term } from "@/components/i18n/term";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getT } from "@/lib/i18n/server";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canCtx } from "@batzio/server/ctx";
import { tenantCtx } from "@/lib/server/session";
import { Icon } from "@/components/icon";
import { REPORT_CATALOG } from "@batzio/server/reports";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Insights") };
}


export default async function ReportsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  const t = await getT();
  return (
    <>
      <PageHeader title={t("Insights")} description={t("How the business is doing, in numbers. Every report exports to PDF and Excel — hover the jargon for plain words.")} />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {REPORT_CATALOG.filter((r) => canCtx(ctx, r.area, "read")).map((r) => (
            <Link key={r.id} href={`/${tenant}/reports/${r.id}`}>
              <Card className="h-full gap-3 shadow-xs transition-shadow hover:shadow-md">
                <CardHeader className="flex flex-row items-start gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-metal text-white">
                    <Icon name={r.icon} className="size-5" />
                  </span>
                  <div className="space-y-1">
                    <CardTitle className="font-display">
                      <Term label={r.title} portal>{t(r.title)}</Term>
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
