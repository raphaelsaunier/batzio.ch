import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentSheet } from "@/components/document/document-sheet";
import { RecordForm } from "@/components/resource/record-form";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getResource } from "@batzio/server/resources/registry";
import { refLabels, resolveDefault } from "@batzio/server/crud";
import { canCtx } from "@batzio/server/ctx";
import { documentSheetContext, newDocumentDefaults, contactSnapshot } from "@/lib/server/document-sheet";
import { formData } from "@batzio/server/forms";
import { tenantCtx } from "@/lib/server/session";
import { resourceView } from "@/lib/server/view";

type Params = { tenant: string; resource: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { resource } = await params;
  const res = getResource(resource);
  if (!res) return { title: "Not found" };
  const view = await resourceView(res);
  return { title: view.t("New: {label}", { label: view.label }) };
}

export default async function NewRecordPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, resource } = await params;
  const search = await searchParams;
  const res = getResource(resource);
  if (!res || res.readOnly || res.noCreate) notFound();
  const ctx = await tenantCtx(tenant);
  if (!canCtx(ctx, res.area, "write")) notFound();

  const { taxes, rounding } = await formData(ctx, res, null);
  const initial: Record<string, unknown> = {};
  for (const f of res.fields) {
    if (f.readOnly) continue;
    if (search[f.name] !== undefined) initial[f.name] = f.type === "ref" || f.type === "int" ? Number(search[f.name]) : search[f.name];
    else if (f.default !== undefined) initial[f.name] = resolveDefault(f.default);
  }
  if (res.view === "document") {
    const contact = await contactSnapshot(ctx, Number(initial.contact_id) || null);
    for (const [k, v] of Object.entries(await newDocumentDefaults(ctx, res, contact))) if (initial[k] === undefined || initial[k] === null) initial[k] = v;
  }
  const labels = await refLabels(ctx, res, [initial], getResource);
  if (res.view === "document") initial.positions = [];
  if (res.name === "journal_entries") initial.lines = [{ amount: "" }];
  if (res.name === "bills") initial.lines = [{ amount: "" }];
  const view = await resourceView(res);
  const { t } = view;
  // “Make it a bill”: show the dropped file next to the form.
  const fileId = Number(search.file_id) || null;
  const file = fileId ? await ctx.db.first<{ id: number; name: string; mime_type: string | null }>("SELECT id, name, mime_type FROM files WHERE id = ?", fileId) : null;
  const preview = file ? `/api/v1/files/${file.id}/download?tenant=${tenant}&inline=1` : null;

  return (
    <>
      <PageHeader
        title={t("New: {label}", { label: view.label })}
        description={view.description}
        crumbs={[{ label: view.labelPlural, href: `/${tenant}/${resource}` }, { label: t("New") }]}
      />
      <PageBody className={preview ? "max-w-[1400px]" : "max-w-6xl"}>
        <div className={preview ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]" : undefined}>
          {res.view === "document" ? (
            <DocumentSheet tenant={tenant} resource={view.client} initial={initial} labels={labels} canWrite taxes={taxes} rounding={rounding} sheet={await documentSheetContext(ctx, res, initial, tenant)} />
          ) : (
            <RecordForm tenant={tenant} resource={view.client} initial={initial} labels={labels} canWrite taxes={taxes} rounding={rounding} />
          )}
          {preview && file && (
            <div className="bg-card sticky top-16 h-[80vh] overflow-hidden rounded-xl border shadow-xs">
              {file.mime_type?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={file.name} className="size-full object-contain" />
              ) : (
                <iframe src={preview} title={file.name} className="size-full" />
              )}
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}
