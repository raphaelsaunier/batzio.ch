import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionBar } from "@/components/resource/action-bar";
import { StatusBadge } from "@/components/resource/cell";
import { DataTable } from "@/components/resource/data-table";
import { RecordAside } from "@/components/resource/record-aside";
import { DocumentSheet } from "@/components/document/document-sheet";
import { RecordForm } from "@/components/resource/record-form";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { RecordTabs } from "@/components/resource/record-tabs";
import { getResource } from "@batzio/server/resources/registry";
import { historyEntry, recordHistory } from "@batzio/server/history";
import { HistoryTimeline } from "@/components/resource/history-timeline";
import { availableActions, findRecord, listRecords, recordTitle, refLabels, toApi } from "@batzio/server/crud";
import { canCtx } from "@batzio/server/ctx";
import { documentSheetContext } from "@/lib/server/document-sheet";
import { formData } from "@batzio/server/forms";
import { tenantCtx } from "@/lib/server/session";
import { resourceView } from "@/lib/server/view";

type Params = { tenant: string; resource: string; id: string };

const PDF_RESOURCES = new Set(["quotes", "orders", "deliveries", "invoices", "credit_notes", "purchase_orders", "reminders", "payslips"]);

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { resource, id } = await params;
  const res = getResource(resource);
  return { title: res ? `${(await resourceView(res)).label} #${id}` : "Not found" };
}

export default async function RecordPage({ params }: { params: Promise<Params> }) {
  const { tenant, resource, id: rawId } = await params;
  const res = getResource(resource);
  const id = Number(rawId);
  if (!res || !Number.isInteger(id)) notFound();
  const ctx = await tenantCtx(tenant);
  if (!canCtx(ctx, res.area, "read")) notFound();
  const record = await findRecord(ctx, res, id);
  if (!record) notFound();

  const { initial, labels, taxes, rounding } = await formData(ctx, res, record);
  const canWrite = canCtx(ctx, res.area, "write");
  const lockReason = res.hooks?.lockReason?.(record) ?? null;
  const actions = canWrite ? availableActions(res, record) : [];
  const view = await resourceView(res);
  const { t, client } = view;
  const statusField = res.statusField ? view.fields.find((f) => f.name === res.statusField) : undefined;
  const title = recordTitle(res, record);
  const apiRecord = toApi(res, record);

  const related = await Promise.all(
    (res.related ?? []).map(async (rel) => {
      const relRes = getResource(rel.resource);
      if (!relRes || !canCtx(ctx, relRes.area, "read")) return null;
      const list = await listRecords(ctx, relRes, { filters: { [rel.foreignKey]: String(id) }, limit: 10 });
      const relView = await resourceView(relRes);
      return { rel, relRes, relView, list, labels: await refLabels(ctx, relRes, list.rows, getResource) };
    }),
  );
  const history = canCtx(ctx, "audit", "read") ? await recordHistory(ctx, t, res.name, id, 50) : [];
  // An audit entry is shown in words above its raw fields.
  const auditEntry = res.name === "audit_log" ? await historyEntry(ctx, t, id) : null;
  const visibleRelated = related.filter((r): r is NonNullable<typeof r> => r !== null);
  const tabs = [
    ...visibleRelated.filter((r) => r.list.total > 0).map((r) => ({ value: r.rel.resource, label: t(r.rel.label), count: r.list.total })),
    ...(history.length ? [{ value: "history", label: t("History"), count: null }] : []),
    ...visibleRelated.filter((r) => r.list.total === 0).map((r) => ({ value: r.rel.resource, label: t(r.rel.label), count: 0 })),
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="truncate">{title}</span>
            {statusField && <StatusBadge field={statusField} value={record[statusField.name]} />}
            {record.archived_at ? <Badge variant="secondary">{t("Archived")}</Badge> : null}
          </span>
        }
        description={view.label}
        crumbs={[{ label: view.labelPlural, href: `/${tenant}/${resource}` }, { label: title }]}
        actions={
          <ActionBar
            tenant={tenant}
            resource={resource}
            recordId={id}
            actions={client.actions.filter((a) => actions.some((x) => x.name === a.name))}
            canDelete={canWrite && !res.readOnly && !res.noDelete}
            deleteLabel={res.softDelete ? t("Archive") : t("Delete")}
            pdfHref={PDF_RESOURCES.has(resource) ? `/api/v1/${resource}/${id}/pdf?tenant=${tenant}` : undefined}
            context={apiRecord}
          />
        }
      />
      <PageBody>
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            {auditEntry && (
              <div className="neu-card p-5">
                <HistoryTimeline tenant={tenant} entries={[auditEntry]} />
              </div>
            )}
            {res.view === "document" ? (
              <DocumentSheet
                key={String(record.updated_at ?? "")}
                tenant={tenant}
                resource={client}
                recordId={id}
                initial={initial}
                labels={labels}
                lockReason={lockReason && t(lockReason)}
                canWrite={canWrite}
                taxes={taxes}
                rounding={rounding}
                sheet={await documentSheetContext(ctx, res, record, tenant)}
              />
            ) : (
              <RecordForm
                key={String(record.updated_at ?? "")}
                tenant={tenant}
                resource={client}
                recordId={id}
                initial={initial}
                labels={labels}
                lockReason={lockReason && t(lockReason)}
                canWrite={canWrite}
                taxes={taxes}
                rounding={rounding}
              />
            )}
            {(visibleRelated.length > 0 || history.length > 0) && (
              <RecordTabs tabs={tabs}>
                {visibleRelated.map(({ rel, relRes, relView, list, labels: relLabels }) => (
                  <TabsContent key={rel.resource} value={rel.resource} className="space-y-2">
                    <DataTable
                      columns={relView.fields.filter((f) => f.list && f.name !== rel.foreignKey).slice(0, 7)}
                      rows={list.rows}
                      labels={relLabels}
                      tenant={tenant}
                      hrefFor={(row) => `/${tenant}/${rel.resource}/${row.id}`}
                      dense
                    />
                    <div className="flex justify-between text-sm">
                      {list.total > list.rows.length ? (
                        <Link className="text-primary hover:underline" href={`/${tenant}/${rel.resource}?${rel.foreignKey}=${id}`}>
                          {t("View all {n}", { n: list.total })} →
                        </Link>
                      ) : (
                        <span />
                      )}
                      {canCtx(ctx, relRes.area, "write") && !relRes.readOnly && !relRes.noCreate && (
                        <Link className="text-primary hover:underline" href={`/${tenant}/${rel.resource}/new?${rel.foreignKey}=${id}`}>
                          + {relView.label}
                        </Link>
                      )}
                    </div>
                  </TabsContent>
                ))}
                {history.length > 0 && (
                  <TabsContent value="history">
                    <HistoryTimeline tenant={tenant} entries={history} />
                  </TabsContent>
                )}
              </RecordTabs>
            )}
          </div>
          <aside className="space-y-4">
            <RecordAside ctx={ctx} res={res} record={record} />
          </aside>
        </div>
      </PageBody>
    </>
  );
}
