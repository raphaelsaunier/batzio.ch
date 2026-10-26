import { calculateDocument, type VatMode } from "@batzio/core/calc/documents";
import { today } from "@batzio/core/format";
import { createRecord, deleteRecord, getRecord, patchColumns, toApi, updateRecord } from "../crud";
import { assertCan, type Ctx } from "../ctx";
import { sendMail } from "../email/outbound";
import { AppError, notFound } from "../errors";
import { audit } from "../audit";
import { renderDocumentPdf, renderReminderPdf, type ReminderRow } from "../pdf/document";
import { getResource } from "../resources/registry";
import type { ResourceDef, Row } from "../resources/types";
import {
  cancelDocument,
  convertDocument,
  copyDocument,
  createReminder,
  deletePayment,
  issueDocument,
  markSent,
  recordPayment,
  revertToDraft,
  setDocumentStatus,
  KIND_RESOURCE,
  type DocKind,
  type DocumentRow,
} from "../sales";
import { DEFAULT_SEQUENCES } from "../numbering";
import { getSettings } from "../settings";
import { loadExtras, saveExtras } from "./extras";
import { currencyCode, currencyId, languageCode, languageId, members, unitId, unitName, userIdFor, userOf, userNumber } from "./lookup";
import { createWire, has, listWire, loadRow, searchWire, updateWire, type Mapping } from "./table";
import { bodyObject, bool, created, date, datetime, dec, ok, pathId, rappen, route, searchWhere, paging, type CompatCall, type Route } from "./wire";

// ------------------------------------------------------------------ kinds

interface WireKind {
  kind: DocKind;
  /** kb_item_status_id per Batzio status. */
  status: Record<string, number>;
  className: string;
}

export const KINDS: Record<string, WireKind> = {
  kb_offer: { kind: "quote", status: { draft: 1, open: 2, accepted: 3, rejected: 4, cancelled: 4 }, className: "KbOffer" },
  kb_order: { kind: "order", status: { draft: 5, open: 5, done: 6, cancelled: 21 }, className: "KbOrder" },
  kb_invoice: { kind: "invoice", status: { draft: 7, open: 8, paid: 9, partial: 16, cancelled: 19, written_off: 31 }, className: "KbInvoice" },
  kb_delivery: { kind: "delivery", status: { draft: 10, delivered: 18, cancelled: 20 }, className: "KbDelivery" },
  kb_credit_voucher: { kind: "credit_note", status: { draft: 7, open: 8, partial: 16, settled: 9, cancelled: 19 }, className: "KbCreditVoucher" },
};

const kindOf = (type: string): WireKind => {
  const k = KINDS[type];
  if (!k) throw new AppError("not_found", "Unknown document type.");
  return k;
};

export const resourceFor = (kind: DocKind): ResourceDef => getResource(KIND_RESOURCE[kind])!;

const statusSql = (k: WireKind) => `CASE status ${Object.entries(k.status).map(([s, n]) => `WHEN '${s}' THEN ${n}`).join(" ")} END`;

/** VAT: 0 = with VAT (net or gross prices), 1 = without, 2 = exempt. */
function mwst(vatMode: unknown) {
  if (vatMode === "none") return { mwst_type: 2, mwst_is_net: true };
  return { mwst_type: 0, mwst_is_net: vatMode !== "incl" };
}

function vatModeFrom(body: Row, existing: Row | null): VatMode | undefined {
  if (!has(body, "mwst_type") && !has(body, "mwst_is_net")) return undefined;
  const type = has(body, "mwst_type") ? Number(body.mwst_type) : mwst(existing?.vat_mode).mwst_type;
  if (type === 1 || type === 2) return "none";
  const net = has(body, "mwst_is_net") ? bool(body.mwst_is_net) : existing?.vat_mode !== "incl";
  return net ? "excl" : "incl";
}

// ------------------------------------------------------------------ positions

export const POSITION_TYPES: Record<string, string> = {
  kb_position_custom: "KbPositionCustom",
  kb_position_article: "KbPositionArticle",
  kb_position_text: "KbPositionText",
  kb_position_subtotal: "KbPositionSubtotal",
  kb_position_discount: "KbPositionDiscount",
  kb_position_pagebreak: "KbPositionPagebreak",
  kb_position_subposition: "KbPositionSubposition",
};

/** Batzio position type ↔ wire type (sub-positions are kept as text with an extra marker). */
function wireType(p: Row, extra: Row | undefined): string {
  if (extra?.type === "KbPositionSubposition") return "KbPositionSubposition";
  return (
    { item: "KbPositionArticle", custom: "KbPositionCustom", text: "KbPositionText", subtotal: "KbPositionSubtotal", discount: "KbPositionDiscount", pagebreak: "KbPositionPagebreak" }[String(p.type)] ??
    "KbPositionCustom"
  );
}

const POSITION_EXTRAS = ["type", "show_pos_nr", "show_pos_prices", "parent_id"];

async function positionsOf(ctx: Ctx, ids: number[]): Promise<Map<number, Row[]>> {
  const out = new Map<number, Row[]>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const rows = await ctx.db.all<Row>(
      `SELECT * FROM document_positions WHERE document_id IN (${chunk.map(() => "?").join(", ")}) ORDER BY document_id, sort, id`,
      ...chunk,
    );
    for (const r of rows) {
      const list = out.get(Number(r.document_id)) ?? [];
      list.push(r);
      out.set(Number(r.document_id), list);
    }
  }
  return out;
}

/** `embedded`: the document's own `positions` list, which shows sub-positions as text headings. */
async function wirePositions(ctx: Ctx, positions: Row[], vatMode: VatMode, embedded = false): Promise<Row[]> {
  const extras = await loadExtras(ctx, "document_positions", positions.map((p) => Number(p.id)));
  const calc = calculateDocument(
    positions.map((p) => ({ ...p, unit_price: Number(p.unit_price), quantity: Number(p.quantity) }) as never),
    vatMode,
  );
  let nr = 0;
  const out: Row[] = [];
  for (const [i, p] of positions.entries()) {
    const extra = extras.get(Number(p.id));
    const type = embedded && extra?.type === "KbPositionSubposition" ? "KbPositionText" : wireType(p, extra);
    const numbered = type === "KbPositionCustom" || type === "KbPositionArticle";
    if (numbered) nr++;
    const base = { id: p.id, internal_pos: i + 1, is_optional: bool(p.is_optional), type, parent_id: (extra?.parent_id as number | undefined) ?? null };
    switch (type) {
      case "KbPositionCustom":
      case "KbPositionArticle":
        out.push({
          ...base,
          amount: dec(p.quantity),
          amount_reserved: dec(0),
          amount_open: dec(p.quantity),
          amount_completed: dec(0),
          unit_id: await unitId(ctx, p.unit_name),
          account_id: p.account_id ?? null,
          unit_name: p.unit_name ?? null,
          tax_id: p.tax_id ?? null,
          tax_value: dec(p.tax_rate ?? 0, 2),
          text: p.text ?? "",
          unit_price: dec(p.unit_price),
          discount_in_percent: p.discount_percent ? dec(p.discount_percent) : null,
          position_total: rappen(p.total),
          pos: String(nr),
          ...(type === "KbPositionArticle" ? { article_id: p.item_id } : {}),
        });
        break;
      case "KbPositionText":
        out.push({ ...base, text: p.text ?? "", show_pos_nr: bool(extra?.show_pos_nr), pos: null });
        break;
      case "KbPositionSubposition":
        out.push({ ...base, text: p.text ?? "", pos: null, show_pos_nr: bool(extra?.show_pos_nr), total_sum: dec(0), show_pos_prices: bool(extra?.show_pos_prices) });
        break;
      case "KbPositionSubtotal":
        out.push({ ...base, text: p.text ?? "", value: rappen(calc.lines[i]?.subtotal ?? 0) });
        break;
      case "KbPositionDiscount": {
        const percent = Number(p.discount_percent ?? 0);
        out.push({
          id: p.id,
          type,
          text: p.text ?? "",
          is_percentual: percent > 0,
          value: percent > 0 ? dec(percent) : dec(p.unit_price),
          discount_total: rappen(-(calc.lines[i]?.total ?? 0)),
        });
        break;
      }
      case "KbPositionPagebreak":
        out.push({ ...base, pagebreak: true });
        break;
    }
  }
  return out;
}

/** A wire position → Batzio position input (API shape, major units). */
async function positionInput(ctx: Ctx, wireTypeName: string, b: Row, existing?: Row): Promise<{ input: Row; extra: Row | null }> {
  const t = wireTypeName;
  const out: Row = existing ? { ...existing } : {};
  let extra: Row | null = null;
  const set = (wireKey: string, key: string, conv: (v: unknown) => unknown = (v) => v) => {
    if (has(b, wireKey)) out[key] = conv(b[wireKey]);
  };
  if (t === "KbPositionCustom" || t === "KbPositionArticle") {
    out.type = t === "KbPositionArticle" ? "item" : "custom";
    set("amount", "quantity", Number);
    set("unit_price", "unit_price", Number);
    set("discount_in_percent", "discount_percent", (v) => (v === null || v === "" ? null : Number(v)));
    set("tax_id", "tax_id");
    set("account_id", "account_id");
    set("text", "text");
    set("is_optional", "is_optional", bool);
    if (has(b, "unit_name")) out.unit_name = b.unit_name;
    else if (has(b, "unit_id")) out.unit_name = await unitName(ctx, b.unit_id);
    if (t === "KbPositionArticle") {
      set("article_id", "item_id");
      if (!existing && out.item_id && (!has(b, "text") || !has(b, "unit_price"))) {
        const item = await ctx.db.first<Row>("SELECT * FROM items WHERE id = ?", out.item_id);
        if (!item) throw new AppError("validation", "Item not found.");
        if (!has(b, "text")) out.text = [item.name, item.description].filter(Boolean).join("\n");
        if (!has(b, "unit_price")) out.unit_price = Number(item.sale_price ?? 0);
        if (!has(b, "tax_id") && item.sales_tax_id) out.tax_id = item.sales_tax_id;
        if (!out.unit_name && item.unit_id) out.unit_name = await unitName(ctx, item.unit_id);
        out.code = item.nr ?? null;
      }
    }
  } else if (t === "KbPositionText" || t === "KbPositionSubposition") {
    out.type = "text";
    set("text", "text");
    set("is_optional", "is_optional", bool);
    if (t === "KbPositionSubposition") extra = { type: t, show_pos_nr: bool(b.show_pos_nr), show_pos_prices: bool(b.show_pos_prices) };
    else if (has(b, "show_pos_nr")) extra = { show_pos_nr: bool(b.show_pos_nr) };
  } else if (t === "KbPositionSubtotal") {
    out.type = "subtotal";
    set("text", "text");
  } else if (t === "KbPositionDiscount") {
    out.type = "discount";
    set("text", "text");
    const percentual = has(b, "is_percentual") ? bool(b.is_percentual) : Number(existing?.discount_percent ?? 0) > 0;
    if (has(b, "value") || has(b, "is_percentual")) {
      const value = Number(has(b, "value") ? b.value : percentual ? existing?.discount_percent : existing?.unit_price) || 0;
      out.discount_percent = percentual ? value : null;
      out.unit_price = percentual ? 0 : value;
    }
  } else if (t === "KbPositionPagebreak") {
    out.type = "pagebreak";
    set("is_optional", "is_optional", bool);
  } else {
    throw new AppError("validation", "Unknown position type.");
  }
  if (has(b, "parent_id") && b.parent_id) extra = { ...(extra ?? {}), parent_id: b.parent_id };
  return { input: out, extra };
}

// ------------------------------------------------------------------ documents

function documentMapping(k: WireKind): Mapping {
  return {
    table: "documents",
    area: k.kind === "purchase_order" ? "purchases" : "sales",
    resource: KIND_RESOURCE[k.kind],
    label: resourceFor(k.kind).label,
    kind: `documents:${k.kind}`,
    scope: { kind: k.kind },
    columns: {
      id: "id",
      document_nr: "nr",
      title: "title",
      contact_id: "contact_id",
      contact_sub_id: "contact_person_id",
      project_id: "project_id",
      pr_project_id: "project_id",
      bank_account_id: "bank_account_id",
      currency_id: { sql: "(SELECT id FROM currencies WHERE code = documents.currency_code)" },
      language_id: { sql: "(SELECT id FROM languages WHERE lower(code) = lower(documents.language))" },
      kb_item_status_id: { sql: statusSql(k) },
      is_valid_from: "date",
      is_valid_to: "due_date",
      is_valid_until: "due_date",
      total: { sql: "total / 100.0" },
      total_net: { sql: "total_net / 100.0" },
      reference: "reference",
      updated_at: "updated_at",
    },
    defaultOrder: "id",
    extras: ["api_reference", "payment_type_id", "template_slug", "show_position_taxes", "kb_terms_of_payment_template_id", "show_total", "logopaper_id"],
    read: async (r, ctx) => readDocument(ctx, k, r, null),
    write: (b, ctx, existing) => documentInput(ctx, b, existing),
  };
}

async function readDocument(ctx: Ctx, k: WireKind, r: Row, positions: Row[] | null): Promise<Row> {
  const vatMode = (r.vat_mode as VatMode) ?? "excl";
  const pos = positions ?? (await positionsOf(ctx, [Number(r.id)])).get(Number(r.id)) ?? [];
  const calc = calculateDocument(pos.map((p) => ({ ...p, unit_price: Number(p.unit_price), quantity: Number(p.quantity) }) as never), vatMode);
  const taxs = calc.vat.filter((v) => v.vat).map((v) => ({ percentage: dec(v.rate), value: rappen(v.vat) }));
  const base: Row = {
    id: r.id,
    document_nr: r.nr ?? "",
    title: r.title ?? null,
    contact_id: r.contact_id ?? null,
    contact_sub_id: r.contact_person_id ?? null,
    user_id: userOf(ctx, r.responsible_user_id),
    logopaper_id: 1,
    language_id: await languageId(ctx, r.language),
    bank_account_id: r.bank_account_id ?? null,
    currency_id: await currencyId(ctx, r.currency_code),
    header: r.header ?? "",
    footer: r.footer ?? "",
    total_gross: rappen(Number(r.total_net ?? 0) + Number(r.total_vat ?? 0)),
    total_net: rappen(r.total_net),
    total_taxes: rappen(r.total_vat),
    total: rappen(r.total),
    total_rounding_difference: Number(r.rounding ?? 0) / 100,
    ...mwst(r.vat_mode),
    is_valid_from: date(r.date),
    contact_address: r.address ?? "",
    kb_item_status_id: k.status[String(r.status)] ?? Object.values(k.status)[0],
    api_reference: null,
    viewed_by_client_at: null,
    updated_at: datetime(r.updated_at),
    taxs,
  };
  if (k.kind !== "delivery") {
    Object.assign(base, {
      project_id: r.project_id ?? null,
      pr_project_id: r.project_id ?? null,
      payment_type_id: 1,
      show_position_taxes: false,
      contact_address_manual: null,
      template_slug: null,
      network_link: null,
    });
  }
  if (k.kind !== "invoice" && k.kind !== "credit_note") {
    Object.assign(base, { delivery_address_type: r.delivery_address ? 1 : 0, delivery_address: r.delivery_address ?? r.address ?? "" });
    if (k.kind !== "delivery") base.delivery_address_manual = r.delivery_address ?? null;
  }
  if (k.kind === "quote") Object.assign(base, { is_valid_until: date(r.due_date), kb_terms_of_payment_template_id: null, show_total: true });
  if (k.kind === "order") base.is_recurring = !!r.repetition;
  if (k.kind === "invoice" || k.kind === "credit_note") {
    Object.assign(base, {
      total_received_payments: rappen(r.amount_paid),
      total_credit_vouchers: rappen(0),
      total_remaining_payments: rappen(r.amount_open),
      is_valid_to: date(r.due_date),
      reference: r.reference ?? null,
      esr_id: 1,
      qr_invoice_id: 1,
    });
  }
  if (positions) base.positions = await wirePositions(ctx, positions, vatMode, true);
  return base;
}

export async function documentInput(ctx: Ctx, b: Row, existing: Row | null): Promise<Row> {
  const out: Row = {};
  const copy = (w: string, ours: string, conv: (v: unknown) => unknown = (v) => (v === "" ? null : v)) => {
    if (has(b, w)) out[ours] = conv(b[w]);
  };
  copy("document_nr", "nr");
  copy("title", "title");
  copy("contact_id", "contact_id");
  copy("contact_sub_id", "contact_person_id");
  copy("project_id", "project_id");
  copy("pr_project_id", "project_id");
  copy("bank_account_id", "bank_account_id");
  copy("header", "header");
  copy("footer", "footer");
  copy("is_valid_from", "date", date);
  copy("is_valid_to", "due_date", date);
  copy("is_valid_until", "due_date", date);
  copy("reference", "reference");
  copy("contact_address_manual", "address");
  copy("delivery_address_manual", "delivery_address");
  if (has(b, "language_id")) out.language = (await languageCode(ctx, b.language_id)) ?? undefined;
  if (has(b, "currency_id")) out.currency_code = (await currencyCode(ctx, b.currency_id)) ?? "CHF";
  if (has(b, "user_id")) out.responsible_user_id = (await userIdFor(ctx, b.user_id)) ?? ctx.user?.id;
  const vat = vatModeFrom(b, existing);
  if (vat) out.vat_mode = vat;
  if (!existing && Array.isArray(b.positions)) {
    out.positions = [];
    for (const p of b.positions as Row[]) (out.positions as Row[]).push((await positionInput(ctx, String(p.type ?? "KbPositionCustom"), p)).input);
  }
  return out;
}

/** Current positions in API shape (ids kept, so position ids stay stable across edits). */
async function apiPositions(ctx: Ctx, res: ResourceDef, docId: number): Promise<{ doc: Row; positions: Row[] }> {
  const doc = await getRecord(ctx, res, docId);
  const api = toApi(res, doc);
  return { doc, positions: ((api.positions as Row[]) ?? []).map((p) => ({ ...p })) };
}

async function savePositions(ctx: Ctx, res: ResourceDef, docId: number, positions: Row[]): Promise<Row[]> {
  await updateRecord(ctx, res, docId, { positions: positions.map((p, i) => ({ ...p, sort: i })) });
  return (await positionsOf(ctx, [docId])).get(docId) ?? [];
}

// ------------------------------------------------------------------ routes

async function loadDocument(ctx: Ctx, k: WireKind, id: number): Promise<Row> {
  return loadRow(ctx, documentMapping(k), id);
}

async function showDocument(ctx: Ctx, k: WireKind, id: number): Promise<Row> {
  const row = await loadDocument(ctx, k, id);
  const positions = (await positionsOf(ctx, [id])).get(id) ?? [];
  const m = documentMapping(k);
  const extras = (await loadExtras(ctx, m.kind!, [id])).get(id);
  const out = await readDocument(ctx, k, row, positions);
  if (extras) for (const f of m.extras!) if (f in extras) out[f] = extras[f];
  return out;
}

async function pdfBody(ctx: Ctx, k: WireKind, id: number) {
  const doc = (await getRecord(ctx, resourceFor(k.kind), id)) as unknown as DocumentRow;
  const bytes = await renderDocumentPdf(ctx, doc);
  return { name: `${doc.nr ?? `${k.kind}-${id}`}.pdf`, size: bytes.byteLength, mime: "application/pdf", content: toBase64(bytes) };
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sendDocument(c: CompatCall, k: WireKind, id: number) {
  const b = bodyObject(c);
  const res = resourceFor(k.kind);
  let doc = (await getRecord(c.ctx, res, id)) as unknown as DocumentRow;
  if (doc.status === "draft" && (b.mark_as_open === undefined || bool(b.mark_as_open))) {
    doc = await issueDocument(c.ctx, doc as unknown as Row);
  }
  const attachments = b.attach_pdf === undefined || bool(b.attach_pdf)
    ? [{ filename: `${doc.nr ?? id}.pdf`, type: "application/pdf", bytes: await renderDocumentPdf(c.ctx, doc) }]
    : [];
  await sendMail(c.ctx, { to: String(b.recipient_email ?? ""), subject: String(b.subject ?? doc.title ?? doc.nr ?? ""), text: String(b.message ?? ""), attachments });
  if (!doc.sent_at) await markSent(c.ctx, doc as unknown as Row);
  return ok;
}

/** Converts a document, keeping only the positions (and amounts) the caller picked. */
async function convert(c: CompatCall, from: WireKind, to: WireKind) {
  const id = pathId(c, from === KINDS.kb_offer ? "quote_id" : "order_id");
  let source = await getRecord(c.ctx, resourceFor(from.kind), id);
  // Orders have no draft stage on the wire: a pending order is confirmed as it is delivered or invoiced.
  if (from.kind === "order" && source.status === "draft") {
    await issueDocument(c.ctx, source);
    source = await getRecord(c.ctx, resourceFor(from.kind), id);
  }
  const target = await convertDocument(c.ctx, source, to.kind);
  const picked = Array.isArray((c.body as Row | null)?.positions) ? ((c.body as Row).positions as Row[]) : null;
  if (picked?.length) {
    const sourcePositions = (source.positions as Row[]) ?? [];
    const res = resourceFor(to.kind);
    const { positions } = await apiPositions(c.ctx, res, target.id);
    const keep: Row[] = [];
    positions.forEach((p, i) => {
      const sourceId = Number(sourcePositions[i]?.id);
      const choice = picked.find((x) => Number(x.id) === sourceId);
      if (!choice) return;
      keep.push(choice.amount !== undefined && (p.type === "item" || p.type === "custom") ? { ...p, quantity: Number(choice.amount) } : p);
    });
    await savePositions(c.ctx, res, target.id, keep);
  }
  return showDocument(c.ctx, to, target.id);
}

async function copy(c: CompatCall, k: WireKind, param: string) {
  const id = pathId(c, param);
  const source = await getRecord(c.ctx, resourceFor(k.kind), id);
  const doc = await copyDocument(c.ctx, source);
  const b = bodyObject(c);
  const changes = await documentInput(c.ctx, b, doc as unknown as Row);
  delete changes.nr;
  if (Object.keys(changes).length) await updateRecord(c.ctx, resourceFor(k.kind), doc.id, changes);
  return showDocument(c.ctx, k, doc.id);
}

const action = (fn: (ctx: Ctx, record: Row) => Promise<unknown>) => async (ctx: Ctx, k: WireKind, id: number) => {
  const record = await getRecord(ctx, resourceFor(k.kind), id);
  await fn(ctx, record);
  return ok;
};

function documentRoutes(type: string, param: string): Route[] {
  const k = kindOf(type);
  const m = documentMapping(k);
  const base = `/2.0/${type}`;
  const item = `${base}/{${param}}`;
  const id = (c: CompatCall) => pathId(c, param);
  return [
    route("GET", base, (c) => listWire(c, m)),
    route("POST", `${base}/search`, (c) => searchWire(c, m)),
    route("POST", base, async (c) => {
      const b = bodyObject(c);
      const row = await createWire(c.ctx, m, b);
      return created(await showDocument(c.ctx, k, Number(row.id)));
    }),
    route("GET", item, (c) => showDocument(c.ctx, k, id(c))),
    route("POST", item, async (c) => {
      await updateWire(c.ctx, m, id(c), bodyObject(c));
      return showDocument(c.ctx, k, id(c));
    }),
    route("DELETE", item, async (c) => {
      const res = resourceFor(k.kind);
      await loadDocument(c.ctx, k, id(c));
      await deleteRecord(c.ctx, res, id(c));
      return ok;
    }),
  ];
}

function positionRoutes(): Route[] {
  const base = "/2.0/{kb_document_type}/{document_id}";
  const routes: Route[] = [];
  for (const [segment, type] of Object.entries(POSITION_TYPES)) {
    const list = `${base}/${segment}`;
    const item = `${list}/{position_id}`;
    const docOf = (c: CompatCall) => {
      const k = kindOf(c.params.kb_document_type);
      return { k, res: resourceFor(k.kind), docId: pathId(c, "document_id") };
    };
    const wired = async (ctx: Ctx, k: WireKind, docId: number) => {
      const doc = await loadDocument(ctx, k, docId);
      const positions = (await positionsOf(ctx, [docId])).get(docId) ?? [];
      return (await wirePositions(ctx, positions, (doc.vat_mode as VatMode) ?? "excl")).filter((p) => p.type === type);
    };
    const one = async (c: CompatCall) => {
      const { k, docId } = docOf(c);
      const hit = (await wired(c.ctx, k, docId)).find((p) => Number(p.id) === pathId(c, "position_id"));
      if (!hit) throw notFound("Position");
      return hit;
    };
    routes.push(
      route("GET", list, async (c) => {
        const { k, docId } = docOf(c);
        const { limit, offset } = paging(c.query);
        return (await wired(c.ctx, k, docId)).slice(offset, offset + limit);
      }),
      route("POST", list, async (c) => {
        const { k, res, docId } = docOf(c);
        await loadDocument(c.ctx, k, docId);
        const { positions } = await apiPositions(c.ctx, res, docId);
        const before = new Set(positions.map((p) => Number(p.id)));
        const { input, extra } = await positionInput(c.ctx, type, bodyObject(c));
        const at = c.body && has(c.body as Row, "internal_pos") ? Math.max(0, Number((c.body as Row).internal_pos) - 1) : positions.length;
        positions.splice(Math.min(at, positions.length), 0, input);
        const saved = await savePositions(c.ctx, res, docId, positions);
        const added = saved.find((p) => !before.has(Number(p.id)));
        if (added && extra) await saveExtras(c.ctx, "document_positions", Number(added.id), extra, POSITION_EXTRAS);
        const all = await wired(c.ctx, k, docId);
        return created(all.find((p) => Number(p.id) === Number(added?.id)) ?? all.at(-1));
      }),
      route("GET", item, one),
      route("POST", item, async (c) => {
        const { k, res, docId } = docOf(c);
        await one(c);
        const pid = pathId(c, "position_id");
        const { positions } = await apiPositions(c.ctx, res, docId);
        const index = positions.findIndex((p) => Number(p.id) === pid);
        const { input, extra } = await positionInput(c.ctx, type, bodyObject(c), positions[index]);
        positions[index] = { ...input, id: pid };
        await savePositions(c.ctx, res, docId, positions);
        if (extra) await saveExtras(c.ctx, "document_positions", pid, extra, POSITION_EXTRAS);
        return (await wired(c.ctx, k, docId)).find((p) => Number(p.id) === pid);
      }),
      route("DELETE", item, async (c) => {
        const { res, docId } = docOf(c);
        await one(c);
        const pid = pathId(c, "position_id");
        const { positions } = await apiPositions(c.ctx, res, docId);
        await savePositions(c.ctx, res, docId, positions.filter((p) => Number(p.id) !== pid));
        return ok;
      }),
    );
  }
  return routes;
}

// ------------------------------------------------------------------ comments

function commentRoutes(): Route[] {
  const base = "/2.0/{kb_document_type}/{document_id}/comment";
  const read = async (ctx: Ctx, r: Row) => {
    const member = (await members(ctx)).find((m) => m.name === r.user_name);
    return {
      id: r.id,
      text: r.body,
      user_id: member ? userNumber(member.user_id) : null,
      user_email: member?.email ?? null,
      user_name: r.user_name ?? null,
      date: datetime(r.created_at),
      is_public: bool(r.is_public),
      image: null,
      image_path: null,
    };
  };
  const doc = async (c: CompatCall) => {
    const k = kindOf(c.params.kb_document_type);
    const docId = pathId(c, "document_id");
    await loadDocument(c.ctx, k, docId);
    return docId;
  };
  return [
    route("GET", base, async (c) => {
      const docId = await doc(c);
      const { limit, offset } = paging(c.query);
      const rows = await c.ctx.db.all<Row>("SELECT * FROM comments WHERE document_id = ? ORDER BY id LIMIT ? OFFSET ?", docId, limit, offset);
      return Promise.all(rows.map((r) => read(c.ctx, r)));
    }),
    route("POST", base, async (c) => {
      const docId = await doc(c);
      const b = bodyObject(c);
      const row = await createRecord(c.ctx, getResource("comments")!, { document_id: docId, body: String(b.text ?? ""), is_public: bool(b.is_public) });
      return created(await read(c.ctx, row));
    }),
    route("GET", `${base}/{comment_id}`, async (c) => {
      const docId = await doc(c);
      const row = await c.ctx.db.first<Row>("SELECT * FROM comments WHERE id = ? AND document_id = ?", pathId(c, "comment_id"), docId);
      if (!row) throw notFound("Comment");
      return read(c.ctx, row);
    }),
  ];
}

// ------------------------------------------------------------------ payments & reminders

const readPayment = (r: Row) => ({
  id: r.id,
  date: date(r.date),
  value: rappen(r.amount),
  bank_account_id: r.bank_account_id ?? null,
  title: null,
  payment_service_id: null,
  is_client_account_redemption: false,
  is_cash_discount: bool(r.is_cash_discount),
  kb_invoice_id: r.document_id,
  kb_credit_voucher_id: null,
  kb_bill_id: null,
  kb_credit_voucher_text: null,
});

async function readReminder(ctx: Ctx, r: Row): Promise<Row> {
  const invoice = await ctx.db.first<Row>("SELECT amount_open, amount_paid FROM documents WHERE id = ?", r.document_id);
  const days = r.date && r.due_date ? Math.round((Date.parse(String(r.due_date)) - Date.parse(String(r.date))) / 86_400_000) : 10;
  return {
    id: r.id,
    kb_invoice_id: r.document_id,
    title: r.title ?? null,
    is_valid_from: date(r.date),
    is_valid_to: date(r.due_date),
    reminder_period_in_days: days,
    reminder_level: Number(r.level),
    show_positions: false,
    remaining_price: rappen(Number(invoice?.amount_open ?? 0) + Number(r.fee ?? 0)),
    received_total: rappen(invoice?.amount_paid),
    is_sent: r.status === "sent",
    header: r.header ?? null,
    footer: r.footer ?? null,
  };
}

function invoiceExtras(): Route[] {
  const k = KINDS.kb_invoice;
  const res = () => resourceFor("invoice");
  const invoiceId = (c: CompatCall) => pathId(c, "invoice_id");
  const invoice = (c: CompatCall) => getRecord(c.ctx, res(), invoiceId(c));
  const reminder = async (c: CompatCall) => {
    const row = await c.ctx.db.first<Row>("SELECT * FROM reminders WHERE id = ? AND document_id = ?", pathId(c, "reminder_id"), invoiceId(c));
    if (!row) throw notFound("Reminder");
    return row;
  };
  const payment = async (c: CompatCall) => {
    const row = await c.ctx.db.first<Row>("SELECT * FROM document_payments WHERE id = ? AND document_id = ?", pathId(c, "payment_id"), invoiceId(c));
    if (!row) throw notFound("Payment");
    return row;
  };
  const reminderStatus = async (c: CompatCall, sent: boolean) => {
    assertCan(c.ctx, "sales", "write");
    const r = await reminder(c);
    await patchColumns(c.ctx, { table: "reminders" }, Number(r.id), { status: sent ? "sent" : "draft", sent_at: sent ? new Date().toISOString() : null });
    await audit(c.ctx, { action: sent ? "mark_sent" : "mark_unsent", resource: "reminders", resourceId: Number(r.id), summary: `Reminder ${r.level} ${sent ? "sent" : "not sent"}` });
    return ok;
  };
  return [
    route("GET", "/2.0/kb_invoice/{invoice_id}/pdf", async (c) => pdfBody(c.ctx, k, invoiceId(c))),
    route("POST", "/2.0/kb_invoice/{invoice_id}/copy", (c) => copy(c, k, "invoice_id")),
    route("POST", "/2.0/kb_invoice/{invoice_id}/issue", (c) => action(issueDocument)(c.ctx, k, invoiceId(c))),
    route("POST", "/2.0/kb_invoice/{invoice_id}/revert_issue", (c) => action(revertToDraft)(c.ctx, k, invoiceId(c))),
    route("POST", "/2.0/kb_invoice/{invoice_id}/cancel", (c) => action(cancelDocument)(c.ctx, k, invoiceId(c))),
    route("POST", "/2.0/kb_invoice/{invoice_id}/mark_as_sent", (c) => action(markSent)(c.ctx, k, invoiceId(c))),
    route("POST", "/2.0/kb_invoice/{invoice_id}/send", (c) => sendDocument(c, k, invoiceId(c))),

    route("GET", "/2.0/kb_invoice/{invoice_id}/payment", async (c) => {
      await invoice(c);
      const { limit, offset } = paging(c.query);
      const rows = await c.ctx.db.all<Row>("SELECT * FROM document_payments WHERE document_id = ? ORDER BY id LIMIT ? OFFSET ?", invoiceId(c), limit, offset);
      return rows.map(readPayment);
    }),
    route("POST", "/2.0/kb_invoice/{invoice_id}/payment", async (c) => {
      const b = bodyObject(c);
      const record = await invoice(c);
      const before = Number(await c.ctx.db.value("SELECT coalesce(max(id), 0) FROM document_payments")) || 0;
      await recordPayment(c.ctx, record, {
        date: date(b.date) ?? today(),
        amount: Math.round(Number(b.value) * 100),
        bank_account_id: (b.bank_account_id as number) ?? null,
        payment_type_id: null,
        title: null,
        is_cash_discount: bool(b.is_cash_discount),
      });
      const row = await c.ctx.db.first<Row>("SELECT * FROM document_payments WHERE document_id = ? AND id > ? ORDER BY id DESC LIMIT 1", invoiceId(c), before);
      return created(readPayment(row ?? {}));
    }),
    route("GET", "/2.0/kb_invoice/{invoice_id}/payment/{payment_id}", async (c) => readPayment(await payment(c))),
    route("DELETE", "/2.0/kb_invoice/{invoice_id}/payment/{payment_id}", async (c) => {
      const p = await payment(c);
      await deletePayment(c.ctx, await invoice(c), Number(p.id));
      return ok;
    }),

    route("GET", "/2.0/kb_invoice/{invoice_id}/kb_reminder", async (c) => {
      await invoice(c);
      const rows = await c.ctx.db.all<Row>("SELECT * FROM reminders WHERE document_id = ? ORDER BY level, id", invoiceId(c));
      return Promise.all(rows.map((r) => readReminder(c.ctx, r)));
    }),
    route("POST", "/2.0/kb_invoice/{invoice_id}/kb_reminder", async (c) => {
      const id = await createReminder(c.ctx, await invoice(c));
      return created(await readReminder(c.ctx, (await c.ctx.db.first<Row>("SELECT * FROM reminders WHERE id = ?", id))!));
    }),
    route("POST", "/2.0/kb_invoice/{invoice_id}/kb_reminder/search", async (c) => {
      await invoice(c);
      const s = searchWhere(c.body ?? [], {
        id: "id",
        title: "title",
        reminder_level: "level",
        is_valid_from: "date",
        is_valid_to: "due_date",
        is_sent: { sql: "CASE status WHEN 'sent' THEN 1 ELSE 0 END", value: (v) => (bool(v) ? 1 : 0) },
      });
      const rows = await c.ctx.db.all<Row>(`SELECT * FROM reminders WHERE document_id = ?${s.sql.map((x) => ` AND ${x}`).join("")} ORDER BY level, id`, invoiceId(c), ...s.args);
      return Promise.all(rows.map((r) => readReminder(c.ctx, r)));
    }),
    route("GET", "/2.0/kb_invoice/{invoice_id}/kb_reminder/{reminder_id}", async (c) => readReminder(c.ctx, await reminder(c))),
    route("DELETE", "/2.0/kb_invoice/{invoice_id}/kb_reminder/{reminder_id}", async (c) => {
      const r = await reminder(c);
      await deleteRecord(c.ctx, getResource("reminders")!, Number(r.id));
      return ok;
    }),
    route("POST", "/2.0/kb_invoice/{invoice_id}/kb_reminder/{reminder_id}/mark_as_sent", (c) => reminderStatus(c, true)),
    route("POST", "/2.0/kb_invoice/{invoice_id}/kb_reminder/{reminder_id}/mark_as_unsent", (c) => reminderStatus(c, false)),
    route("POST", "/2.0/kb_invoice/{invoice_id}/kb_reminder/{reminder_id}/send", async (c) => {
      const r = await reminder(c);
      const doc = (await invoice(c)) as unknown as DocumentRow;
      const b = bodyObject(c);
      const bytes = await renderReminderPdf(c.ctx, r as unknown as ReminderRow, doc);
      await sendMail(c.ctx, {
        to: String(b.recipient_email ?? ""),
        subject: String(b.subject ?? r.title ?? ""),
        text: String(b.message ?? ""),
        attachments: [{ filename: `reminder-${doc.nr ?? doc.id}-${r.level}.pdf`, type: "application/pdf", bytes }],
      });
      return reminderStatus(c, true);
    }),
    route("GET", "/2.0/kb_invoice/{invoice_id}/kb_reminder/{reminder_id}/pdf", async (c) => {
      const r = await reminder(c);
      const doc = (await invoice(c)) as unknown as DocumentRow;
      const bytes = await renderReminderPdf(c.ctx, r as unknown as ReminderRow, doc);
      return { name: `reminder-${doc.nr ?? doc.id}-${r.level}.pdf`, size: bytes.byteLength, mime: "application/pdf", content: toBase64(bytes) };
    }),
  ];
}

// ------------------------------------------------------------------ quotes, orders, deliveries

function quoteExtras(): Route[] {
  const k = KINDS.kb_offer;
  const id = (c: CompatCall) => pathId(c, "quote_id");
  const status = (s: string, stamp?: string) => async (ctx: Ctx, record: Row) => setDocumentStatus(ctx, record, s, stamp ? { [stamp]: new Date().toISOString() } : {});
  return [
    route("POST", "/2.0/kb_offer/{quote_id}/issue", (c) => action(issueDocument)(c.ctx, k, id(c))),
    route("POST", "/2.0/kb_offer/{quote_id}/revertIssue", (c) => action(revertToDraft)(c.ctx, k, id(c))),
    route("POST", "/2.0/kb_offer/{quote_id}/accept", (c) => action(status("accepted", "accepted_at"))(c.ctx, k, id(c))),
    route("POST", "/2.0/kb_offer/{quote_id}/reject", (c) => action(status("rejected", "rejected_at"))(c.ctx, k, id(c))),
    route("POST", "/2.0/kb_offer/{quote_id}/reissue", (c) => action(status("open"))(c.ctx, k, id(c))),
    route("POST", "/2.0/kb_offer/{quote_id}/mark_as_sent", (c) => action(markSent)(c.ctx, k, id(c))),
    route("GET", "/2.0/kb_offer/{quote_id}/pdf", (c) => pdfBody(c.ctx, k, id(c))),
    route("POST", "/2.0/kb_offer/{quote_id}/send", (c) => sendDocument(c, k, id(c))),
    route("POST", "/2.0/kb_offer/{quote_id}/copy", (c) => copy(c, k, "quote_id")),
    route("POST", "/2.0/kb_offer/{quote_id}/order", (c) => convert(c, k, KINDS.kb_order)),
    route("POST", "/2.0/kb_offer/{quote_id}/invoice", (c) => convert(c, k, KINDS.kb_invoice)),
  ];
}

const REPEAT_TO_WIRE: Record<string, { type: string; factor: number }> = {
  daily: { type: "daily", factor: 1 },
  weekly: { type: "weekly", factor: 1 },
  monthly: { type: "monthly", factor: 1 },
  quarterly: { type: "monthly", factor: 3 },
  semiannual: { type: "monthly", factor: 6 },
  yearly: { type: "yearly", factor: 1 },
};

function orderExtras(): Route[] {
  const k = KINDS.kb_order;
  const id = (c: CompatCall) => pathId(c, "order_id");
  const res = () => resourceFor("order");
  const readRepetition = (raw: unknown) => {
    let rep: Row | null = null;
    try {
      rep = raw ? (JSON.parse(String(raw)) as Row) : null;
    } catch {
      rep = null;
    }
    if (!rep) throw notFound("Repetition");
    const t = REPEAT_TO_WIRE[String(rep.interval)] ?? REPEAT_TO_WIRE.monthly;
    const interval = Math.max(1, Number(rep.every ?? 1)) * t.factor;
    const repetition: Row = { type: t.type, interval };
    if (t.type === "weekly") repetition.weekdays = (rep.weekdays as string[] | undefined) ?? ["monday"];
    if (t.type === "monthly") repetition.schedule = (rep.schedule as string | undefined) ?? "fixed_day";
    return { start: date(rep.start), end: date(rep.end), repetition };
  };
  return [
    route("POST", "/2.0/kb_order/{order_id}/delivery", (c) => convert(c, k, KINDS.kb_delivery)),
    route("POST", "/2.0/kb_order/{order_id}/invoice", (c) => convert(c, k, KINDS.kb_invoice)),
    route("GET", "/2.0/kb_order/{order_id}/pdf", (c) => pdfBody(c.ctx, k, id(c))),
    route("GET", "/2.0/kb_order/{order_id}/repetition", async (c) => readRepetition((await loadDocument(c.ctx, k, id(c))).repetition)),
    route("POST", "/2.0/kb_order/{order_id}/repetition", async (c) => {
      const b = bodyObject(c);
      const r = (b.repetition ?? {}) as Row;
      const n = Math.max(1, Number(r.interval ?? 1));
      const type = String(r.type ?? "monthly");
      const interval =
        type === "daily" ? "daily" : type === "weekly" ? "weekly" : type === "yearly" ? "yearly" : n % 6 === 0 ? "semiannual" : n % 3 === 0 ? "quarterly" : "monthly";
      const every = interval === "semiannual" ? n / 6 : interval === "quarterly" ? n / 3 : n;
      const start = date(b.start) ?? today();
      const repetition = { interval, every, start, end: date(b.end), ...(r.weekdays ? { weekdays: r.weekdays } : {}), ...(r.schedule ? { schedule: r.schedule } : {}) };
      await loadDocument(c.ctx, k, id(c));
      // Recurrence does not touch bookings, so it can change on confirmed orders too.
      await updateRecord(c.ctx, res(), id(c), { repetition, next_run_date: start }, { force: true });
      return readRepetition(JSON.stringify(repetition));
    }),
    route("DELETE", "/2.0/kb_order/{order_id}/repetition", async (c) => {
      await loadDocument(c.ctx, k, id(c));
      await updateRecord(c.ctx, res(), id(c), { repetition: null, next_run_date: null }, { force: true });
      return ok;
    }),
  ];
}

function deliveryRoutes(): Route[] {
  const k = KINDS.kb_delivery;
  const m = documentMapping(k);
  return [
    route("GET", "/2.0/kb_delivery", (c) => listWire(c, m)),
    route("GET", "/2.0/kb_delivery/{delivery_id}", (c) => showDocument(c.ctx, k, pathId(c, "delivery_id"))),
    route("POST", "/2.0/kb_delivery/{delivery_id}/issue", (c) => action(issueDocument)(c.ctx, k, pathId(c, "delivery_id"))),
  ];
}

// ------------------------------------------------------------------ settings

async function itemSettings(ctx: Ctx) {
  assertCan(ctx, "sales", "read");
  const rows = await ctx.db.all<Row>("SELECT * FROM sequences");
  const accounting = await getSettings(ctx, "accounting");
  const company = await getSettings(ctx, "company");
  const bank = await ctx.db.value<number>("SELECT id FROM bank_accounts ORDER BY is_default DESC, id LIMIT 1");
  const classes: Record<string, string> = { quote: "KbOffer", order: "KbOrder", invoice: "KbInvoice", delivery: "KbDelivery", credit_note: "KbCreditVoucher", purchase_order: "KbArticleOrder" };
  return Promise.all(
    DEFAULT_SEQUENCES.filter((s) => classes[s.key]).map(async (s, i) => {
      const row = rows.find((r) => r.key === s.key);
      const format = String(row?.format ?? s.format);
      return {
        id: i + 1,
        text: s.label,
        kb_item_class: classes[s.key],
        enumeration_format: format,
        use_automatic_enumeration: true,
        use_yearly_enumeration: (row?.reset ?? s.reset) === "yearly",
        next_nr: Number(row?.next_value ?? s.start ?? 1),
        nr_min_length: (format.match(/#/g) ?? []).length,
        default_time_period_in_days: s.key === "quote" ? Number(accounting.quote_validity_days ?? 30) : Number(accounting.default_payment_days ?? 30),
        default_logopaper_id: 1,
        default_language_id: await languageId(ctx, company.language ?? "de"),
        default_client_bank_account_new_id: bank ?? null,
        default_currency_id: await currencyId(ctx, "CHF"),
        default_mwst_type: 0,
        default_mwst_is_net: true,
        default_nb_decimals_amount: 2,
        default_nb_decimals_price: 2,
        default_show_position_taxes: false,
        default_title: s.label,
        default_show_esr_on_same_page: true,
        default_payment_type_id: 1,
        kb_terms_of_payment_template_id: null,
        default_show_total: true,
      };
    }),
  );
}

export function documentRoutesAll(): Route[] {
  return [
    ...documentRoutes("kb_offer", "quote_id"),
    ...quoteExtras(),
    ...documentRoutes("kb_order", "order_id"),
    ...orderExtras(),
    ...documentRoutes("kb_invoice", "invoice_id"),
    ...invoiceExtras(),
    ...deliveryRoutes(),
    ...positionRoutes(),
    ...commentRoutes(),
    route("GET", "/2.0/kb_item_setting", (c) => itemSettings(c.ctx)),
  ];
}
