import type { Metadata } from "next";
import { MoveIn } from "@/components/settings/move-in";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getEnv } from "@batzio/server/env";
import { importProgress } from "@batzio/server/importer";
import { getT } from "@/lib/i18n/server";
import { tenantCtx } from "@/lib/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Move in") };
}

export default async function MoveInPage({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await getT();
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  return (
    <>
      <PageHeader
        title={t("Move in")}
        description={t("Switch from your current accounting software in one click.")}
        crumbs={[{ label: t("Settings"), href: `/${tenant}/settings` }, { label: t("Move in") }]}
      />
      <PageBody>
        <MoveIn tenant={tenant} defaultUrl={getEnv().IMPORT_SOURCE_URL ?? ""} last={await importProgress(ctx)} />
      </PageBody>
    </>
  );
}
