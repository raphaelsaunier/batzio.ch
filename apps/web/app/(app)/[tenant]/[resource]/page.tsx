import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Batzi } from "@/components/fun/batzi";
import { DataTable, Pager } from "@/components/resource/data-table";
import { LocalResourceList } from "@/components/resource/local-list";
import { isClientNavigation } from "@/lib/navigation";
import { ListToolbar } from "@/components/resource/list-toolbar";
import { ListExtras } from "@/components/resource/list-extras";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { daysBetween, today } from "@batzio/core/format";
import { familyTabs } from "@batzio/server/navigation";
import { getResource } from "@batzio/server/resources/registry";
import type { Row } from "@batzio/server/resources/types";
import { canCtx } from "@batzio/server/ctx";
import { listParamsFrom, listRecords, refLabels, sumColumns } from "@batzio/server/crud";
import { tenantCtx } from "@/lib/server/session";
import { resourceView } from "@/lib/server/view";
import { cn } from "@/lib/utils";

type Params = { tenant: string; resource: string };
type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { resource } = await params;
  const res = getResource(resource);
  return { title: res ? (await resourceView(res)).labelPlural : "Not found" };
}

/** Open items past their due date get a small “late” badge. */
const LATE: Record<string, string[]> = { invoices: ["open", "partial"], bills: ["booked", "partial"], reminders: [] };

export default async function ResourceListPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { tenant, resource } = await params;
  const search = await searchParams;
  const res = getResource(resource);
  if (!res) notFound();
  const ctx = await tenantCtx(tenant);
  if (!canCtx(ctx, res.area, "read")) notFound();

  const view = await resourceView(res);
  const { t } = view;
  const tabs = familyTabs(tenant, ctx.role, view.mode, resource);
  // Lists render from the local copy in the browser; archived views and explicit
  // server searches stay server-rendered.
  const local = !("archived" in search) && !("ids" in search) && search.server !== "1";
  // Client-side navigations get no rows at all: the browser already has them.
  const navigation = await isClientNavigation();
  const listParams = listParamsFrom(search);
  const result = local && navigation ? { rows: [], total: 0, limit: listParams.limit ?? 25, offset: 0 } : await listRecords(ctx, res, listParams);
  const labels = await refLabels(ctx, res, result.rows, getResource);
  const columns = view.fields.filter((f) => f.list);
  const moneyColumns = columns.filter((c) => c.type === "money").map((c) => c.name);
  const totals = moneyColumns.length && !local ? await sumColumns(ctx, res, listParams, moneyColumns) : undefined;

  const statusField = res.statusField ? view.fields.find((f) => f.name === res.statusField) : undefined;
  const filterFields = view.fields.filter(
    (f) => f.filter && (f.type === "enum" || f.type === "boolean") && f.name !== res.statusField,
  );
  const page = Math.floor(result.offset / result.limit) + 1;
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const base = `/${tenant}/${resource}`;

  const query = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(search)) if (typeof v === "string") p.set(k, v);
    for (const [k, v] of Object.entries(patch)) (v === null ? p.delete(k) : p.set(k, v));
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const sort = typeof search.sort === "string" ? search.sort : res.defaultSort.field;
  const dir = (typeof search.dir === "string" ? search.dir : typeof search.sort === "string" ? "asc" : res.defaultSort.dir) as "asc" | "desc";
  const canWrite = canCtx(ctx, res.area, "write") && !res.readOnly && !res.noCreate;
  const currentStatus = res.statusField && typeof search[res.statusField] === "string" ? (search[res.statusField] as string) : null;
  const now = today();
  const lateStatuses = LATE[res.name];
  const extra =
    lateStatuses?.length && res.statusField
      ? {
          [res.statusField]: (row: Row) => {
            const due = row.due_date as string | null;
            if (!due || due >= now || !lateStatuses.includes(String(row[res.statusField!]))) return null;
            return (
              <Badge variant="outline" className="border-destructive/25 bg-destructive/10 text-destructive ml-1.5 font-medium">
                {t("late {n}d", { n: daysBetween(due, now) })}
              </Badge>
            );
          },
        }
      : undefined;

  if (local) {
    const stringParams = Object.fromEntries(Object.entries(search).filter((e): e is [string, string] => typeof e[1] === "string"));
    return (
      <>
        {tabs && tabs.tabs.length > 1 && (
          <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 pt-4 sm:px-6" aria-label={t(tabs.title)}>
            {tabs.tabs.map((tab) => (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors",
                  tab.key === resource ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {t(tab.title)}
              </Link>
            ))}
          </nav>
        )}
        <PageHeader
          title={view.labelPlural}
          description={view.description}
          actions={
            <>
              <ListExtras tenant={tenant} resource={res.name} />
              {canWrite && (
                <Button render={<Link href={`${base}/new`} />}>
                  <Plus /> {view.label}
                </Button>
              )}
            </>
          }
        />
        <PageBody>
          <LocalResourceList
            tenant={tenant}
            resource={resource}
            columns={columns}
            fields={view.fields}
            statusField={statusField}
            filterFields={filterFields}
            defaultSort={res.defaultSort}
            canCreate={canWrite}
            label={view.label}
            softDelete={!!res.softDelete}
            empty={view.empty}
            lateStatuses={LATE[res.name]}
            params={stringParams}
            initial={navigation ? null : { rows: result.rows, labels, total: result.total }}
            renderedAt={Date.now()}
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      {tabs && tabs.tabs.length > 1 && (
        <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 pt-4 sm:px-6" aria-label={t(tabs.title)}>
          {tabs.tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={cn(
                "rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors",
                tab.key === resource ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {t(tab.title)}
            </Link>
          ))}
        </nav>
      )}
      <PageHeader
        title={view.labelPlural}
        description={view.description}
        actions={
          <>
            <ListExtras tenant={tenant} resource={res.name} />
            {canWrite && (
              <Button render={<Link href={`${base}/new`} />}>
                <Plus /> {view.label}
              </Button>
            )}
          </>
        }
      >
        {statusField?.options && (
          <div className="-mb-5 mt-5 flex gap-1 overflow-x-auto">
            {[{ value: null as string | null, label: t("All") }, ...statusField.options].map((o) => {
              const active = currentStatus === o.value || (!currentStatus && o.value === null);
              return (
                <Link
                  key={o.value ?? "all"}
                  href={query({ [statusField.name]: o.value, page: null })}
                  className={cn(
                    "border-b-2 px-3 pb-2.5 text-sm whitespace-nowrap transition-colors",
                    active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </Link>
              );
            })}
          </div>
        )}
      </PageHeader>
      <PageBody className="space-y-4">
        <ListToolbar filters={filterFields} exportHref={`/api/v1/${resource}?format=xlsx&tenant=${tenant}`} archivable={res.softDelete} />
        <DataTable
          columns={columns}
          rows={result.rows}
          labels={labels}
          tenant={tenant}
          hrefFor={(row) => `${base}/${row.id}`}
          sort={sort}
          dir={dir}
          sortHref={(field) => query({ sort: field, dir: sort === field && dir === "asc" ? "desc" : "asc", page: null })}
          totals={totals}
          extra={extra}
          empty={
            <div className="flex flex-col items-center gap-3 py-6">
              <Batzi mood={view.empty?.mood ?? "sleepy"} className="size-16" />
              <div>
                <p className="font-display text-foreground text-base font-semibold">{view.empty?.title ?? t("Nothing here yet")}</p>
                {view.empty?.text && <p className="mx-auto max-w-sm text-sm">{view.empty.text}</p>}
              </div>
              {canWrite && (
                <Button variant="outline" size="sm" render={<Link href={`${base}/new`} />}>
                  <Plus /> {t("Create the first one")}
                </Button>
              )}
            </div>
          }
        />
        <Pager page={page} pages={pages} total={result.total} hrefFor={(p) => query({ page: String(p) })} />
      </PageBody>
    </>
  );
}
