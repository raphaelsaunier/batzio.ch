"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { MODE_COOKIE, type UiMode } from "@batzio/server/friendly";
import { getResource } from "@batzio/server/resources/registry";
import type { Row } from "@batzio/server/resources/types";
import { globalSearch, itemDefaults, refOptions, type ItemDefaults, type RefOption, type SearchHit as ServerSearchHit } from "@batzio/server/lookup";
import { createRecord, deleteRecord, runAction, updateRecord } from "@batzio/server/crud";
import { canCtx } from "@batzio/server/ctx";
import { AppError, errorText, toAppError } from "@batzio/server/errors";
import { getT } from "@/lib/i18n/server";
import { tenantCtx } from "@/lib/server/session";
import { contactSnapshot } from "@/lib/server/document-sheet";

export interface ActionResponse {
  ok: boolean;
  id?: number;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  redirect?: string;
}

async function fail(error: unknown): Promise<ActionResponse> {
  const e = toAppError(error);
  return { ok: false, error: errorText(e, await getT()), fields: e.fields };
}

function resourceOrThrow(name: string) {
  const res = getResource(name);
  if (!res) throw new AppError("not_found", "Unknown resource {name}.", undefined, { name });
  return res;
}

export async function saveRecordAction(tenant: string, resource: string, id: number | null, payload: Row): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    const res = resourceOrThrow(resource);
    const record = id ? await updateRecord(ctx, res, id, payload) : await createRecord(ctx, res, payload);
    revalidatePath(`/${tenant}/${resource}`);
    const t = await getT();
    return { ok: true, id: Number(record.id), message: t(id ? "{label} saved." : "{label} created.", { label: t(res.label) }) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteRecordAction(tenant: string, resource: string, id: number): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    const res = resourceOrThrow(resource);
    await deleteRecord(ctx, res, id);
    revalidatePath(`/${tenant}/${resource}`);
    const t = await getT();
    return { ok: true, message: t(res.softDelete ? "{label} archived." : "{label} deleted.", { label: t(res.label) }), redirect: `/${tenant}/${resource}` };
  } catch (error) {
    return fail(error);
  }
}

export async function runRecordAction(tenant: string, resource: string, id: number, action: string, input: Row = {}): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    const res = resourceOrThrow(resource);
    const result = await runAction(ctx, res, id, action, input);
    revalidatePath(`/${tenant}/${resource}/${id}`);
    const t = await getT();
    return {
      ok: true,
      message: result.message && t(result.message, result.vars),
      redirect: result.redirect ? `/${tenant}/${result.redirect.resource}/${result.redirect.id}` : undefined,
    };
  } catch (error) {
    return fail(error);
  }
}

export type { ItemDefaults, RefOption } from "@batzio/server/lookup";
export type SearchHit = ServerSearchHit & { href: string };

/** Options for reference pickers, with optional text search and equality filters. */
export async function refOptionsAction(
  tenant: string,
  resource: string,
  query: string,
  filter?: Record<string, string | number | boolean>,
  ids?: number[],
): Promise<RefOption[]> {
  return refOptions(await tenantCtx(tenant), resource, query, filter, ids);
}

/** Prices, texts and VAT of a catalogue item for document positions. */
export async function itemDefaultsAction(tenant: string, itemId: number, purchase = false): Promise<ItemDefaults | null> {
  return itemDefaults(await tenantCtx(tenant), itemId, purchase);
}

export async function globalSearchAction(tenant: string, query: string): Promise<SearchHit[]> {
  const hits = await globalSearch(await tenantCtx(tenant), query);
  return hits.map((h) => ({ ...h, href: `/${tenant}/${h.resource}/${h.id}` }));
}

/** Switches between plain-language and accountant views (per browser). */
export async function setModeAction(mode: UiMode): Promise<void> {
  (await cookies()).set(MODE_COOKIE, mode === "accountant" ? "accountant" : "simple", {
    path: "/",
    sameSite: "lax",
    maxAge: 365 * 86_400,
  });
  revalidatePath("/", "layout");
}

export type { ContactSnapshot } from "@batzio/server/document-defaults";
import type { ContactSnapshot } from "@batzio/server/document-defaults";

/** What a document prints for a contact: the address block, customer number and language. */
export async function contactSnapshotAction(tenant: string, contactId: number, personId?: number | null): Promise<ContactSnapshot | null> {
  const ctx = await tenantCtx(tenant);
  if (!canCtx(ctx, "contacts", "read")) return null;
  return contactSnapshot(ctx, contactId, personId);
}
