"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { MODE_COOKIE, type UiMode } from "@/lib/friendly";
import { getResource } from "@/lib/resources/registry";
import type { Row } from "@/lib/resources/types";
import { ident, placeholders } from "@/lib/server/db/db";
import { createRecord, deleteRecord, runAction, updateRecord } from "@/lib/server/crud";
import { canCtx } from "@/lib/server/ctx";
import { AppError, errorText, toAppError } from "@/lib/server/errors";
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

export interface RefOption {
  id: number;
  label: string;
}

/** Options for reference pickers, with optional text search and equality filters. */
export async function refOptionsAction(
  tenant: string,
  resource: string,
  query: string,
  filter?: Record<string, string | number | boolean>,
  ids?: number[],
): Promise<RefOption[]> {
  const ctx = await tenantCtx(tenant);
  const res = getResource(resource);
  if (!res || !canCtx(ctx, res.area, "read")) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(res.scope ?? {})) {
    where.push(`${ident(k)} = ?`);
    args.push(v);
  }
  if (res.softDelete) where.push("archived_at IS NULL");
  if (ids?.length) {
    where.push(`id IN (${placeholders(ids.length)})`);
    args.push(...ids);
  } else {
    for (const [k, v] of Object.entries(filter ?? {})) {
      if (!res.fields.some((f) => f.name === k)) continue;
      // Picking an open invoice should also include partially paid ones.
      if (k === "status" && v === "open") {
        where.push("status IN ('open','partial')");
        continue;
      }
      where.push(`${ident(k)} = ?`);
      args.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
    if (query.trim()) {
      const like = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const parts = [`(${res.titleSql}) LIKE ? ESCAPE '\\'`];
      args.push(like);
      for (const f of res.fields.filter((x) => x.search).slice(0, 4)) {
        parts.push(`${ident(f.name)} LIKE ? ESCAPE '\\'`);
        args.push(like);
      }
      where.push(`(${parts.join(" OR ")})`);
    }
  }
  const order = res.defaultSort.field;
  const rows = await ctx.db.all<{ id: number; label: string }>(
    `SELECT id, (${res.titleSql}) AS label FROM ${ident(res.table)} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${ident(order)} ${res.defaultSort.dir === "desc" ? "DESC" : "ASC"} LIMIT 30`,
    ...args,
  );
  return rows.map((r) => ({ id: r.id, label: r.label ?? `#${r.id}` }));
}

export interface ItemDefaults {
  code: string | null;
  text: string;
  unit_name: string | null;
  unit_price: number;
  tax_id: number | null;
  tax_label: string | null;
}

/** Prices, texts and VAT of a catalogue item for document positions. */
export async function itemDefaultsAction(tenant: string, itemId: number, purchase = false): Promise<ItemDefaults | null> {
  const ctx = await tenantCtx(tenant);
  const item = await ctx.db.first<Record<string, unknown>>(
    `SELECT items.*, units.name AS unit_label, t.id AS tax_id_resolved, t.code || ' (' || t.rate || '%)' AS tax_label
     FROM items LEFT JOIN units ON units.id = items.unit_id
     LEFT JOIN taxes t ON t.id = ${purchase ? "items.purchase_tax_id" : "items.sales_tax_id"}
     WHERE items.id = ?`,
    itemId,
  );
  if (!item) return null;
  return {
    code: (item.nr as string) ?? null,
    text: [item.name, item.description].filter(Boolean).join("\n"),
    unit_name: (item.unit_label as string) ?? null,
    unit_price: Number((purchase ? item.purchase_price : item.sale_price) ?? 0),
    tax_id: (item.tax_id_resolved as number) ?? null,
    tax_label: (item.tax_label as string) ?? null,
  };
}

export interface SearchHit {
  resource: string;
  resourceLabel: string;
  id: number;
  label: string;
  href: string;
}

const SEARCHABLE = ["contacts", "invoices", "quotes", "orders", "bills", "items", "projects", "accounts", "employees"];

export async function globalSearchAction(tenant: string, query: string): Promise<SearchHit[]> {
  const ctx = await tenantCtx(tenant);
  const q = query.trim();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const name of SEARCHABLE) {
    const res = getResource(name)!;
    if (!canCtx(ctx, res.area, "read")) continue;
    const options = await refOptionsAction(tenant, name, q);
    for (const o of options.slice(0, 5)) {
      hits.push({ resource: name, resourceLabel: res.labelPlural, id: o.id, label: o.label, href: `/${tenant}/${name}/${o.id}` });
    }
  }
  return hits;
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

export interface ContactSnapshot {
  address: string;
  nr: string | null;
  language: string | null;
  payment_term_id: number | null;
  /** Structured address for the QR-bill “payable by” block (needs postcode and town). */
  debtor: { name: string; street: string | null; houseNumber: string | null; postcode: string; town: string; country: string } | null;
}

/** What a document prints for a contact: the address block, customer number and language. */
export async function contactSnapshotAction(tenant: string, contactId: number, personId?: number | null): Promise<ContactSnapshot | null> {
  const ctx = await tenantCtx(tenant);
  if (!canCtx(ctx, "contacts", "read")) return null;
  return contactSnapshot(ctx, contactId, personId);
}
