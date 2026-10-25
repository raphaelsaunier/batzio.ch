"use client";

import { ArrowDown, ArrowUp, Calculator, Check, FileDown, Minus, Package, Pencil, Percent, Plus, Save, SeparatorHorizontal, Trash2, Type, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { contactSnapshotAction, itemDefaultsAction, saveRecordAction, type ContactSnapshot } from "@/app/(app)/[tenant]/actions";
import { moveRow, newKey, type ChildRow } from "@/components/resource/children-editor";
import { FieldInput, type FormLabels, type FormValues } from "@/components/resource/field-input";
import type { TaxOption } from "@/components/resource/positions-editor";
import { RefSelect } from "@/components/resource/ref-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { calculateDocument, type VatMode } from "@/lib/calc/documents";
import { formatAmount, formatDate, formatDecimal } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { fromCents } from "@/lib/money";
import type { ClientResource } from "@/lib/resources/client";
import type { FieldDef } from "@/lib/resources/types";
import { t as docLabel, type LabelKey } from "@/lib/server/pdf/i18n";
import { formatIban, isValidIban } from "@/lib/swiss/iban";
import type { QrBillData } from "@/lib/swiss/qr-bill";
import { createScorReference } from "@/lib/swiss/references";
import { cn } from "@/lib/utils";
import { QrSlip } from "./qr-slip";

/**
 * The document editor *is* the printout: an A4 sheet laid out with the same
 * millimetre/point geometry as the PDF renderer. Hover a section to edit it
 * in place; everything outside the paper (handles, chips, toolbars) is
 * editing furniture and never printed.
 */

export interface SheetCompany {
  name: string;
  legal_form: string;
  street: string;
  house_number: string;
  postcode: string;
  city: string;
  country_code: string;
  phone: string;
  email: string;
  website: string;
  vat_number: string;
  accent_color: string;
  language: string;
}

export interface SheetBank {
  id: number;
  iban: string | null;
  qr_iban: string | null;
}

export interface SheetContext {
  kind: string;
  company: SheetCompany;
  logoUrl: string | null;
  banks: SheetBank[];
  contact: ContactSnapshot | null;
  person: string | null;
  nr: string | null;
  status: string;
  amountPaid: number;
  amountOpen: number;
  qrReference: string | null;
  pdfHref?: string;
  /** Built-in intro/closing texts per document language. */
  defaults: Record<string, { header: string | null; footer: string | null }>;
}

const SKIP = new Set(["id", "created_at", "updated_at", "created_by", "updated_by"]);
const PT_PER_MM = 72 / 25.4;
const PX_PER_MM = 96 / 25.4;
const PAGE = { width: 210, height: 297, top: 20, bottom: 22, left: 20, right: 18 };
const CONTENT = PAGE.width - PAGE.left - PAGE.right; // 172 mm
const FLOW_TOP = 95;
const QR_HEIGHT = 105;

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/['’\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const toStr = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const TITLE_KEY: Record<string, LabelKey> = { quote: "quote", order: "order", delivery: "delivery", invoice: "invoice", credit_note: "credit_note", purchase_order: "purchase_order" };

/** A field that looks printed until you hover or focus it. */
function Inline({
  value,
  onChange,
  editable,
  placeholder,
  multiline,
  align,
  style,
  className,
  label,
  display,
  invalid,
}: {
  value: string;
  onChange?: (v: string) => void;
  editable: boolean;
  placeholder?: string;
  multiline?: boolean;
  align?: "left" | "right";
  style?: React.CSSProperties;
  className?: string;
  label: string;
  /** Formatted text shown while not focused (numbers). */
  display?: string;
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, focused]);
  const shown = !focused && display !== undefined ? display : value;
  if (!editable) {
    return (
      <span className={cn("block whitespace-pre-wrap", className)} style={{ textAlign: align, ...style }}>
        {display ?? value}
      </span>
    );
  }
  const common = {
    "aria-label": label,
    placeholder,
    className: cn("sheet-input", invalid && "sheet-invalid", className),
    style: { textAlign: align, ...style },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
  return multiline ? (
    <textarea ref={ref} rows={1} value={shown} onChange={(e) => onChange?.(e.target.value)} {...common} />
  ) : (
    <input value={shown} onChange={(e) => onChange?.(e.target.value)} inputMode={display !== undefined ? "decimal" : undefined} {...common} />
  );
}

/** A section of the sheet that reveals an edit chip (and a popover) on hover. */
function Zone({
  label,
  editable,
  invalid,
  children,
  panel,
  className,
  style,
  side = "left",
}: {
  label: string;
  editable: boolean;
  invalid?: boolean;
  children: React.ReactNode;
  panel?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  side?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  if (!editable) return <div className={className} style={style}>{children}</div>;
  const body = (
    <div
      role={panel ? "button" : undefined}
      tabIndex={panel ? 0 : undefined}
      className={cn("sheet-zone group/zone", panel && "cursor-pointer", open && "sheet-zone-open", invalid && "sheet-zone-invalid", className)}
      style={style}
    >
      <span className={cn("sheet-zone-chip", side === "right" ? "right-0" : "left-0")}>
        <Pencil className="size-3" /> {label}
      </span>
      {children}
    </div>
  );
  if (!panel) return body;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{body}</PopoverTrigger>
      <PopoverContent side={side} align="start" sideOffset={14} collisionPadding={12} className="neu-panel w-[22rem] space-y-3 p-4">
        <p className="font-display text-sm font-semibold">{label}</p>
        {panel}
      </PopoverContent>
    </Popover>
  );
}

function PanelField({ field, value, onChange, tenant, labels, onLabels, error }: { field?: FieldDef; value: unknown; onChange: (v: unknown) => void; tenant: string; labels: FormLabels; onLabels: (k: string, l: Record<string, string>) => void; error?: string }) {
  if (!field) return null;
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-xs font-medium">{field.label}</span>
      <FieldInput id={`sheet-${field.name}`} field={field} value={value} onChange={onChange} tenant={tenant} labels={labels} onLabels={onLabels} invalid={!!error} />
      {error && <span className="text-destructive text-xs">{error}</span>}
    </label>
  );
}

function cleanRows(rows: ChildRow[], writable: Set<string>) {
  return rows.map((r, i) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (writable.has(k) && k !== "id") out[k] = v === "" ? null : v;
    if (writable.has("sort")) out.sort = i;
    return out;
  });
}

function toRows(rows: unknown): ChildRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row: ChildRow = { _key: newKey() };
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) row[k] = typeof v === "number" ? String(v) : v;
    return row;
  });
}

export function DocumentSheet({
  tenant,
  resource,
  recordId,
  initial,
  labels: initialLabels,
  lockReason,
  canWrite,
  taxes = [],
  rounding = {},
  sheet,
}: {
  tenant: string;
  resource: ClientResource;
  recordId?: number;
  initial: FormValues;
  labels: FormLabels;
  lockReason?: string | null;
  canWrite: boolean;
  taxes?: TaxOption[];
  rounding?: Record<string, number>;
  sheet: SheetContext;
}) {
  const t = useT();
  const router = useRouter();
  const isCreate = !recordId;
  const editable = canWrite && !lockReason && !resource.readOnly;
  const field = useCallback((name: string) => resource.fields.find((f) => f.name === name), [resource]);
  const positionsChild = resource.children.find((c) => c.name === "positions");
  const writableChild = useMemo(() => new Set((positionsChild?.fields ?? []).filter((f) => !f.readOnly).map((f) => f.name)), [positionsChild]);
  const writableFields = useMemo(() => resource.fields.filter((f) => !SKIP.has(f.name) && !f.hidden && !f.readOnly), [resource]);

  const initialValues = () => {
    const v: FormValues = {};
    for (const [k, val] of Object.entries(initial)) v[k] = typeof val === "number" ? String(val) : val;
    return v;
  };
  const [values, setValues] = useState<FormValues>(initialValues);
  const [rows, setRows] = useState<ChildRow[]>(() => toRows(initial.positions));
  const [labels, setLabels] = useState<FormLabels>(initialLabels);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [contact, setContact] = useState<ContactSnapshot | null>(sheet.contact);
  const [pending, start] = useTransition();
  const [, startLookup] = useTransition();

  /** Switching language swaps the built-in texts too (unless they were edited). */
  const withLanguage = (v: FormValues, next: unknown): FormValues => {
    const prev = toStr(v.language) || sheet.company.language;
    const to = toStr(next) || sheet.company.language;
    const out: FormValues = { ...v, language: next };
    for (const part of ["header", "footer"] as const) {
      const was = sheet.defaults[prev]?.[part];
      if (!v[part] || (was && v[part] === was)) out[part] = sheet.defaults[to]?.[part] ?? v[part];
    }
    return out;
  };
  const set = (name: string, value: unknown) => {
    if (name === "language") {
      setValues((v) => withLanguage(v, value));
      setDirty(true);
      return;
    }
    setValues((v) => ({ ...v, [name]: value }));
    setDirty(true);
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };
  const setLabelsFor = (key: string, l: Record<string, string>) => setLabels((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...l } }));
  const setRowsDirty = (next: ChildRow[]) => {
    setRows(next);
    setDirty(true);
  };

  const pickContact = (id: unknown) => {
    set("contact_id", id);
    if (!id) return;
    startLookup(async () => {
      const snap = await contactSnapshotAction(tenant, Number(id), values.contact_person_id ? Number(values.contact_person_id) : null);
      if (!snap) return;
      setContact(snap);
      setValues((v) => {
        const next = { ...v, address: snap.address, ...(snap.payment_term_id && !v.payment_term_id ? { payment_term_id: snap.payment_term_id } : {}) };
        return snap.language ? withLanguage(next, snap.language) : next;
      });
    });
  };

  const save = useCallback(() => {
    const payload: Record<string, unknown> = {};
    for (const f of writableFields) {
      if (!isCreate && f.createOnly) continue;
      const v = values[f.name];
      payload[f.name] = v === "" ? null : v;
    }
    if (positionsChild) payload.positions = cleanRows(rows, writableChild);
    start(async () => {
      const r = await saveRecordAction(tenant, resource.name, recordId ?? null, payload);
      if (!r.ok) {
        setErrors(r.fields ?? {});
        toast.error(r.error ?? t("Could not save."));
        return;
      }
      setDirty(false);
      toast.success(r.message);
      if (isCreate) router.push(`/${tenant}/${resource.name}/${r.id}`);
      else router.refresh();
    });
  }, [writableFields, isCreate, values, positionsChild, rows, writableChild, tenant, resource.name, recordId, router, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey) && editable) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, editable]);

  // ----------------------------------------------------------- calculation
  const vatMode = ((values.vat_mode as VatMode) || "excl") as VatMode;
  const currency = toStr(values.currency_code) || "CHF";
  const rateOf = (id: unknown) => taxes.find((x) => x.id === Number(id))?.rate ?? 0;
  const purchase = resource.name === "purchase_orders";
  const taxList = taxes.filter((x) => x.type === (purchase ? "purchase" : "sales"));
  const defaultTax = taxList.find((x) => x.code === (purchase ? "VM81" : "UN81")) ?? taxList[0];
  const calc = calculateDocument(
    rows.map((r) => ({
      type: toStr(r.type) || "custom",
      quantity: num(r.quantity),
      unit_price: num(r.unit_price),
      discount_percent: num(r.discount_percent),
      tax_id: vatMode === "none" ? null : r.tax_id ? Number(r.tax_id) : null,
      tax_rate: vatMode === "none" ? 0 : rateOf(r.tax_id),
      is_optional: !!r.is_optional,
    })),
    vatMode,
    rounding[currency] ?? 0.01,
  );

  // ---------------------------------------------------------------- labels
  const lang = toStr(values.language) || sheet.company.language || "de";
  const L = (key: LabelKey, vars?: Record<string, string>) => docLabel(lang, key, vars);
  const kind = sheet.kind;
  const showPrices = kind !== "delivery";
  const title = `${L(TITLE_KEY[kind] ?? "invoice")} ${sheet.nr ?? ""}`.trim();
  const accent = /^#[0-9a-f]{6}$/i.test(sheet.company.accent_color) ? sheet.company.accent_color : "#2f5f8f";
  const company = sheet.company;
  const companyLine = [company.name + (company.legal_form && !company.name.endsWith(company.legal_form) ? ` ${company.legal_form}` : ""), [company.street, company.house_number].filter(Boolean).join(" "), [company.postcode, company.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
  const contactLines = [[company.street, company.house_number].filter(Boolean).join(" "), [company.postcode, company.city].filter(Boolean).join(" "), company.phone, company.email, company.website].filter(Boolean);
  const bank = sheet.banks.find((b) => b.id === Number(values.bank_account_id)) ?? sheet.banks[0] ?? null;
  const footerText = [companyLine, company.vat_number ? `UID ${company.vat_number}` : null, bank?.iban ? `IBAN ${formatIban(bank.iban)}` : null].filter(Boolean).join("   |   ");

  const dueKey: LabelKey = kind === "quote" ? "due_quote" : kind === "invoice" || kind === "credit_note" ? "due_invoice" : "due_delivery";
  const meta: [string, string, string][] = [[L("date"), formatDate(toStr(values.date)), "date"]];
  if (values.due_date) meta.push([L(dueKey), formatDate(toStr(values.due_date)), "due_date"]);
  if (contact?.nr) meta.push([L("customer_no"), contact.nr, "contact_id"]);
  if (values.reference) meta.push([L("reference"), toStr(values.reference), "reference"]);
  if (sheet.person && values.contact_person_id) meta.push([L("contact"), sheet.person, "contact_person_id"]);
  if (company.vat_number) meta.push([L("vat_no"), company.vat_number, ""]);

  // ---------------------------------------------------------------- QR-bill
  const qr: QrBillData | null = useMemo(() => {
    if (kind !== "invoice" || ["cancelled", "paid", "written_off"].includes(sheet.status)) return null;
    if (!["CHF", "EUR"].includes(currency) || !bank || !company.postcode || !company.city) return null;
    const useQrr = !!sheet.qrReference && !!bank.qr_iban;
    const iban = useQrr ? bank.qr_iban! : bank.iban;
    if (!iban || !isValidIban(iban)) return null;
    let reference: string | null = useQrr ? sheet.qrReference : null;
    if (!reference && sheet.nr) {
      const body = sheet.nr.replace(/[^A-Za-z0-9]/g, "").slice(-21);
      if (body) reference = createScorReference(body);
    }
    const amount = sheet.status === "draft" ? calc.total : sheet.amountOpen;
    return {
      iban,
      creditor: { name: company.name, street: company.street, houseNumber: company.house_number, postcode: company.postcode, town: company.city, country: company.country_code || "CH" },
      amount: amount > 0 ? fromCents(amount) : null,
      currency: currency as "CHF" | "EUR",
      debtor: contact?.debtor ?? null,
      reference,
      message: `${sheet.nr ?? ""}${values.title ? ` ${values.title}` : ""}`.trim().slice(0, 140),
    };
  }, [kind, sheet.status, sheet.qrReference, sheet.nr, sheet.amountOpen, currency, bank, company, calc.total, contact, values.title]);

  // ------------------------------------------------------------ pagination
  const flowRef = useRef<HTMLDivElement>(null);
  const [flowMm, setFlowMm] = useState(120);
  useLayoutEffect(() => {
    const el = flowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFlowMm(el.offsetHeight / PX_PER_MM));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const contentBottom = FLOW_TOP + flowMm;
  const qrOnFirst = !!qr && contentBottom <= PAGE.height - QR_HEIGHT - 8;
  const contentPages = Math.max(1, Math.ceil((contentBottom + PAGE.bottom) / PAGE.height));
  const pages = qr && !qrOnFirst ? contentPages + (contentBottom > (contentPages - 1) * PAGE.height + PAGE.height - QR_HEIGHT - 8 ? 1 : 0) : contentPages;
  const qrPage = qr ? (qrOnFirst ? 1 : pages) : 0;

  // Fit the sheet into the available width.
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const gutter = el.clientWidth > 900 ? 120 : 24;
      setScale(Math.min(1.15, (el.clientWidth - gutter) / (PAGE.width * PX_PER_MM)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------- positions
  const setRow = (index: number, patch: Record<string, unknown>) => setRowsDirty(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const addRow = (type: string, at = rows.length) => {
    const base: ChildRow = { _key: newKey(), type };
    if (type === "item" || type === "custom") Object.assign(base, { quantity: "1", unit_price: "", tax_id: vatMode === "none" ? null : (defaultTax?.id ?? null) });
    if (type === "discount") Object.assign(base, { text: L("discount"), discount_percent: "5" });
    const next = [...rows];
    next.splice(at, 0, base);
    setRowsDirty(next);
    return base._key;
  };
  const pickItem = (index: number, id: number | null, label: string | null) => {
    if (!id) return;
    if (label) setLabelsFor(`positions.${rows[index]._key}.item_id`, { [id]: label });
    startLookup(async () => {
      const d = await itemDefaultsAction(tenant, id, purchase);
      if (!d) return;
      setRowsDirty(
        rows.map((r, i) =>
          i === index ? { ...r, type: "item", item_id: id, code: d.code, text: d.text, unit_name: d.unit_name, unit_price: String(d.unit_price), tax_id: vatMode === "none" ? null : (d.tax_id ?? r.tax_id ?? defaultTax?.id ?? null) } : r,
        ),
      );
    });
  };

  const cols = showPrices ? "10mm 72mm 14mm 2mm 18mm 18mm 12mm 26mm" : "10mm 128mm 16mm 2mm 16mm";
  const anyDiscount = rows.some((r) => (r.type === "item" || r.type === "custom") && num(r.discount_percent));
  let posNr = 0;

  const paid = (kind === "invoice" || kind === "credit_note") && sheet.amountPaid > 0;
  const vatLines = calc.vat.filter((b) => b.rate > 0 && vatMode !== "none");
  const STAMP: Record<string, { text: string; tone: string } | undefined> = {
    paid: { text: t("Paid"), tone: "text-emerald-700 border-emerald-700" },
    cancelled: { text: t("Cancelled"), tone: "text-rose-700 border-rose-700" },
    written_off: { text: t("Written off"), tone: "text-rose-700 border-rose-700" },
    accepted: { text: t("Accepted"), tone: "text-emerald-700 border-emerald-700" },
  };
  const stamp = STAMP[sheet.status];

  const panelProps = { tenant, labels, onLabels: setLabelsFor };

  return (
    <div className="space-y-4">
      <div ref={viewport} className="desk relative overflow-hidden rounded-3xl px-2 py-8 sm:py-12">
        <div className="mx-auto" style={{ width: `${PAGE.width * PX_PER_MM * scale}px`, height: `${(pages * PAGE.height * PX_PER_MM + (pages - 1) * 24) * scale}px` }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: `${PAGE.width}mm` }}>
            {/* Paper: one sheet per page, the content flows across them. */}
            <div className="relative" style={{ width: `${PAGE.width}mm` }}>
              {Array.from({ length: pages }, (_, i) => (
                <div key={i} className="paper absolute left-0" style={{ top: `calc(${i * PAGE.height}mm + ${i * 24}px)`, width: `${PAGE.width}mm`, height: `${PAGE.height}mm` }} aria-hidden>
                  {i + 1 !== qrPage && (
                    <div className="absolute flex justify-between" style={{ left: `${PAGE.left}mm`, right: `${PAGE.right}mm`, bottom: "12mm", fontSize: "7pt", color: "rgb(107,117,133)", lineHeight: 1 }}>
                      <span className="truncate pr-4">{footerText}</span>
                      <span className="shrink-0">
                        {L("page")} {i + 1}/{pages}
                      </span>
                    </div>
                  )}
                  {i + 1 === qrPage && qr && (
                    <div className="absolute inset-x-0 bottom-0">
                      <QrSlip data={qr} lang={lang} />
                    </div>
                  )}
                </div>
              ))}

              <article className="sheet relative" style={{ width: `${PAGE.width}mm`, minHeight: `${PAGE.height}mm`, color: "rgb(31,38,51)", ["--accent" as string]: accent }}>
                {/* Letterhead */}
                <div className="absolute inset-x-0 top-0" style={{ height: "4pt", background: accent }} />
                {sheet.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sheet.logoUrl} alt="" className="absolute object-contain object-left-top" style={{ left: `${PAGE.left}mm`, top: "13mm", maxWidth: "60mm", maxHeight: "14mm" }} />
                ) : (
                  <p className="absolute" style={{ left: `${PAGE.left}mm`, top: "18mm", fontSize: "15pt", fontWeight: 700, color: accent, lineHeight: 1 }}>
                    {company.name || t("Your company")}
                  </p>
                )}
                <div className="absolute text-right" style={{ right: `${PAGE.right}mm`, top: "18mm", fontSize: "8pt", lineHeight: "10pt", color: "rgb(107,117,133)" }}>
                  {contactLines.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </div>

                {/* Address window (Swiss right-window envelope) */}
                <Zone
                  label={t("Customer")}
                  editable={editable}
                  invalid={!!errors.contact_id || !!errors.address}
                  side="right"
                  className="absolute"
                  style={{ left: "118mm", top: "45mm", width: "80mm", minHeight: "32mm" }}
                  panel={
                    <div className="space-y-3">
                      <label className="block space-y-1">
                        <span className="text-muted-foreground text-xs font-medium">{field("contact_id")?.label}</span>
                        <RefSelect
                          tenant={tenant}
                          resource="contacts"
                          value={values.contact_id ? Number(values.contact_id) : null}
                          label={labels.contact_id?.[toStr(values.contact_id)] ?? null}
                          filter={field("contact_id")?.refFilter}
                          onChange={(id, label) => {
                            if (id && label) setLabelsFor("contact_id", { [id]: label });
                            pickContact(id);
                          }}
                        />
                      </label>
                      <PanelField field={field("contact_person_id")} value={values.contact_person_id} onChange={(v) => set("contact_person_id", v)} {...panelProps} />
                      <PanelField field={field("address")} value={values.address} onChange={(v) => set("address", v)} {...panelProps} error={errors.address} />
                    </div>
                  }
                >
                  <p className="border-b" style={{ fontSize: "6.5pt", color: "rgb(107,117,133)", lineHeight: 1, display: "inline-block", borderColor: "rgb(107,117,133)", borderBottomWidth: "0.3pt", paddingBottom: "1pt" }}>
                    {companyLine}
                  </p>
                  <div style={{ marginTop: `${6 * PT_PER_MM}pt`, fontSize: "10pt", lineHeight: "12pt", whiteSpace: "pre-line" }}>
                    {toStr(values.address)
                      .split(/\r?\n/)
                      .filter(Boolean)
                      .slice(0, 7)
                      .join("\n") || <span className="sheet-hint">{t("Who is this for? Pick a customer.")}</span>}
                  </div>
                </Zone>

                {/* Flowing content from 95 mm, like the PDF cursor */}
                <div ref={flowRef} className="absolute" style={{ top: `${FLOW_TOP}mm`, left: `${PAGE.left}mm`, width: `${CONTENT}mm` }}>
                  <p style={{ fontSize: "16pt", fontWeight: 700, lineHeight: 1, height: "24pt" }}>{title}</p>

                  <Zone
                    label={t("Details")}
                    editable={editable}
                    invalid={["date", "due_date", "reference", "language", "currency_code", "vat_mode"].some((k) => errors[k])}
                    panel={
                      <div className="grid grid-cols-2 gap-3">
                        {["date", "due_date", "reference", "language", "currency_code", "vat_mode", "payment_term_id", "bank_account_id", "project_id"].map((name) => (
                          <div key={name} className={name === "reference" || name === "project_id" || name === "bank_account_id" ? "col-span-2" : undefined}>
                            <PanelField field={field(name)} value={values[name]} onChange={(v) => set(name, v)} {...panelProps} error={errors[name]} />
                          </div>
                        ))}
                        {currency !== "CHF" && (
                          <div className="col-span-2">
                            <PanelField field={field("exchange_rate")} value={values.exchange_rate} onChange={(v) => set("exchange_rate", v)} {...panelProps} />
                          </div>
                        )}
                      </div>
                    }
                  >
                    <div className="grid" style={{ gridTemplateColumns: "30mm 55mm 30mm 57mm", rowGap: "3.5pt", paddingBottom: "12pt" }}>
                      {meta.map(([label, value]) => (
                        <div key={label} className="contents">
                          <span style={{ fontSize: "8pt", color: "rgb(107,117,133)", lineHeight: "8.5pt" }}>{label}</span>
                          <span style={{ fontSize: "8.5pt", lineHeight: "8.5pt" }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </Zone>

                  {/* Title line */}
                  <div className={cn("sheet-optional", !values.title && "sheet-optional-empty")} data-editable={editable || undefined}>
                    <Inline
                      label={field("title")?.label ?? "Title"}
                      value={toStr(values.title)}
                      onChange={(v) => set("title", v)}
                      editable={editable}
                      placeholder={t("Add a subject line…")}
                      style={{ fontSize: "10.5pt", fontWeight: 700, lineHeight: 1, height: "16pt", paddingBottom: "5.5pt" }}
                    />
                  </div>

                  {/* Intro text */}
                  <div className={cn("sheet-optional", !values.header && "sheet-optional-empty")} data-editable={editable || undefined}>
                    <Inline
                      label={field("header")?.label ?? "Intro"}
                      value={toStr(values.header)}
                      onChange={(v) => set("header", v)}
                      editable={editable}
                      multiline
                      placeholder={t("Add an intro text…")}
                      style={{ fontSize: "9pt", lineHeight: 1.35, marginBottom: "8pt" }}
                    />
                  </div>

                  {/* Positions */}
                  <div className="grid items-center" style={{ gridTemplateColumns: cols, background: `color-mix(in srgb, ${accent} 8%, white)`, margin: "-3pt -2pt 2pt", padding: "3pt 2pt 3pt", height: "16pt", fontSize: "7.5pt", fontWeight: 700, color: accent, lineHeight: 1 }}>
                    <span>{L("pos")}</span>
                    <span>{L("description")}</span>
                    <span className="text-right">{L("qty")}</span>
                    <span />
                    <span>{L("unit")}</span>
                    {showPrices && (
                      <>
                        <span className="text-right">{L("price")}</span>
                        <span className="text-right">{anyDiscount ? L("discount") : ""}</span>
                        <span className="text-right">{L("total")}</span>
                      </>
                    )}
                  </div>

                  {rows.map((row, i) => {
                    const type = toStr(row.type) || "custom";
                    const line = calc.lines[i];
                    const priced = type === "item" || type === "custom";
                    const controls = editable && (
                      <>
                        <div className="sheet-gutter sheet-gutter-left">
                          <span className="neu-chip cursor-default" title={type}>
                            {type === "item" ? <Package /> : type === "text" ? <Type /> : type === "subtotal" ? <Minus /> : type === "discount" ? <Percent /> : type === "pagebreak" ? <SeparatorHorizontal /> : <Calculator />}
                          </span>
                          <button type="button" className="neu-chip" aria-label={t("Move up")} disabled={i === 0} onClick={() => setRowsDirty(moveRow(rows, i, -1))}>
                            <ArrowUp />
                          </button>
                          <button type="button" className="neu-chip" aria-label={t("Move down")} disabled={i === rows.length - 1} onClick={() => setRowsDirty(moveRow(rows, i, 1))}>
                            <ArrowDown />
                          </button>
                          <button type="button" className="neu-chip hover:text-destructive" aria-label={t("Remove position")} onClick={() => setRowsDirty(rows.filter((_, j) => j !== i))}>
                            <Trash2 />
                          </button>
                        </div>
                        {priced && (
                          <div className="sheet-gutter sheet-gutter-right">
                            {vatMode !== "none" && (
                              <select
                                aria-label={t("VAT")}
                                title={t("VAT")}
                                className="neu-chip w-auto appearance-none px-1"
                                value={toStr(row.tax_id)}
                                onChange={(e) => setRow(i, { tax_id: e.target.value ? Number(e.target.value) : null })}
                              >
                                <option value="">0%</option>
                                {taxList.map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {formatDecimal(x.rate, 1)}% {x.code}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button type="button" title={t("Optional")} aria-pressed={!!row.is_optional} className={cn("neu-chip w-auto px-1", !!row.is_optional && "neu-chip-on")} onClick={() => setRow(i, { is_optional: !row.is_optional })}>
                              {t("Opt.")}
                            </button>
                            {type === "item" || !row.text ? (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button type="button" className="neu-chip" title={t("Product")} aria-label={t("Product")}>
                                    <Package />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="neu-panel w-72 p-3" side="right">
                                  <RefSelect tenant={tenant} resource="items" value={row.item_id ? Number(row.item_id) : null} label={labels[`positions.${row._key}.item_id`]?.[toStr(row.item_id)] ?? null} onChange={(id, label) => pickItem(i, id, label)} />
                                </PopoverContent>
                              </Popover>
                            ) : null}
                          </div>
                        )}
                      </>
                    );

                    if (type === "pagebreak") {
                      return (
                        <div key={row._key} className="sheet-row group/row relative flex items-center justify-center" style={{ height: "10pt" }}>
                          {controls}
                          <span className="sheet-hint border-t border-dashed px-2" style={{ fontSize: "7pt" }}>
                            {t("Page break")}
                          </span>
                        </div>
                      );
                    }
                    if (type === "text") {
                      return (
                        <div key={row._key} className="sheet-row group/row relative grid" style={{ gridTemplateColumns: `10mm ${CONTENT - 10}mm`, paddingBottom: "6pt" }}>
                          {controls}
                          <span />
                          <Inline label={t("Text")} value={toStr(row.text)} onChange={(v) => setRow(i, { text: v })} editable={editable} multiline placeholder={t("Heading or text block")} style={{ fontSize: "9pt", fontWeight: 700, lineHeight: 1.35 }} />
                        </div>
                      );
                    }
                    if (type === "subtotal") {
                      if (!showPrices) return null;
                      return (
                        <div key={row._key} className="sheet-row group/row relative grid items-baseline" style={{ gridTemplateColumns: cols, height: "16pt", fontSize: "9pt", fontWeight: 700, paddingTop: "3pt" }}>
                          {controls}
                          <span className="absolute" style={{ left: `${CONTENT - 38 - 20}mm`, right: 0, top: 0, borderTop: "0.6pt solid rgb(31,38,51)" }} />
                          <span />
                          <span>{L("subtotal")}</span>
                          <span />
                          <span />
                          <span />
                          <span />
                          <span />
                          <span className="text-right">{formatAmount(line?.subtotal ?? 0)}</span>
                        </div>
                      );
                    }
                    if (type === "discount") {
                      if (!showPrices) return null;
                      return (
                        <div key={row._key} className="sheet-row group/row relative grid items-baseline" style={{ gridTemplateColumns: cols, minHeight: "14pt", fontSize: "9pt", lineHeight: 1.35 }}>
                          {controls}
                          <span />
                          <div className="flex items-baseline gap-1">
                            <Inline label={t("Discount")} value={toStr(row.text)} onChange={(v) => setRow(i, { text: v })} editable={editable} placeholder={L("discount")} style={{ width: "auto", flex: 1 }} />
                            <Inline
                              label={t("Disc. %")}
                              value={toStr(row.discount_percent)}
                              display={row.discount_percent ? `${formatDecimal(num(row.discount_percent), 2)}%` : ""}
                              onChange={(v) => setRow(i, { discount_percent: v })}
                              editable={editable}
                              align="right"
                              placeholder="%"
                              style={{ width: "16mm" }}
                            />
                          </div>
                          <span />
                          <span />
                          <span />
                          <span />
                          <span />
                          <span className="text-right">{formatAmount(line?.total ?? 0)}</span>
                        </div>
                      );
                    }
                    posNr++;
                    const optional = !!row.is_optional;
                    const muted = optional ? { color: "rgb(107,117,133)" } : undefined;
                    return (
                      <div key={row._key} className="sheet-row group/row relative" style={{ borderBottom: "0.3pt solid rgb(212,219,230)", padding: "0 0 1pt", marginBottom: "3pt" }}>
                        {controls}
                        <div className="grid items-start" style={{ gridTemplateColumns: cols, fontSize: "9pt", lineHeight: 1.35, minHeight: "12pt", ...muted }}>
                          <span style={{ color: "rgb(107,117,133)" }}>{posNr}</span>
                          <div className="flex items-start gap-[3pt]">
                            {row.code ? <span className="shrink-0">{toStr(row.code)}</span> : null}
                            <Inline label={t("Description")} value={toStr(row.text)} onChange={(v) => setRow(i, { text: v })} editable={editable} multiline placeholder={t("What did you do or sell?")} invalid={!!errors[`positions.${i}.text`]} />
                          </div>
                          <Inline
                            label={t("Qty")}
                            value={toStr(row.quantity)}
                            display={formatDecimal(num(row.quantity), 3)}
                            onChange={(v) => setRow(i, { quantity: v })}
                            editable={editable}
                            align="right"
                          />
                          <span />
                          <Inline label={t("Unit")} value={toStr(row.unit_name)} onChange={(v) => setRow(i, { unit_name: v })} editable={editable} placeholder="h" />
                          {showPrices && (
                            <>
                              <Inline
                                label={t("Price")}
                                value={toStr(row.unit_price)}
                                display={row.unit_price === "" || row.unit_price === undefined ? "" : formatDecimal(num(row.unit_price), 4, 2)}
                                onChange={(v) => setRow(i, { unit_price: v })}
                                editable={editable}
                                align="right"
                                placeholder="0.00"
                              />
                              <Inline
                                label={t("Disc. %")}
                                value={toStr(row.discount_percent)}
                                display={num(row.discount_percent) ? `${formatDecimal(num(row.discount_percent), 2)}%` : ""}
                                onChange={(v) => setRow(i, { discount_percent: v })}
                                editable={editable}
                                align="right"
                              />
                              <span className="text-right">{optional ? `(${formatAmount(line?.total ?? 0)})` : formatAmount(line?.total ?? 0)}</span>
                            </>
                          )}
                        </div>
                        {optional && <p style={{ marginLeft: "10mm", fontSize: "7pt", color: "rgb(107,117,133)" }}>{L("optional")}</p>}
                      </div>
                    );
                  })}

                  {editable && (
                    <div className="sheet-add group/add">
                      <span className="sheet-add-line" />
                      <div className="sheet-add-buttons">
                        <button type="button" className="neu-chip w-auto px-2" onClick={() => addRow("custom")}>
                          <Plus /> {t("Line")}
                        </button>
                        <button type="button" className="neu-chip w-auto px-2" onClick={() => addRow("item")}>
                          <Package /> {t("Product")}
                        </button>
                        <button type="button" className="neu-chip w-auto px-2" onClick={() => addRow("text")}>
                          <Type /> {t("Text")}
                        </button>
                        {showPrices && (
                          <>
                            <button type="button" className="neu-chip w-auto px-2" onClick={() => addRow("subtotal")}>
                              <Minus /> {t("Subtotal")}
                            </button>
                            <button type="button" className="neu-chip w-auto px-2" onClick={() => addRow("discount")}>
                              <Percent /> {t("Discount")}
                            </button>
                          </>
                        )}
                        <button type="button" className="neu-chip w-auto px-2" onClick={() => addRow("pagebreak")}>
                          <SeparatorHorizontal /> {t("Page break")}
                        </button>
                      </div>
                    </div>
                  )}
                  {rows.length === 0 && !editable && <p className="sheet-hint" style={{ fontSize: "9pt" }}>—</p>}

                  {/* Totals */}
                  {showPrices && (
                    <Zone
                      label={t("VAT & totals")}
                      editable={editable}
                      className="ml-auto"
                      side="right"
                      style={{ width: "92mm", marginTop: "6pt" }}
                      panel={
                        <div className="space-y-3">
                          <PanelField field={field("vat_mode")} value={values.vat_mode} onChange={(v) => set("vat_mode", v)} {...panelProps} />
                          <PanelField field={field("currency_code")} value={values.currency_code} onChange={(v) => set("currency_code", v)} {...panelProps} />
                        </div>
                      }
                    >
                      <div style={{ fontSize: "9pt", lineHeight: "13pt" }}>
                        {vatMode === "excl" && (
                          <>
                            <div className="flex justify-between">
                              <span style={{ color: "rgb(107,117,133)" }}>{L("net_total")}</span>
                              <span>{formatAmount(calc.totalNet)}</span>
                            </div>
                            {vatLines.map((b) => (
                              <div key={`${b.taxId}-${b.rate}`} className="flex justify-between">
                                <span style={{ color: "rgb(107,117,133)" }}>
                                  {L("vat_on", { rate: formatDecimal(b.rate, 1) })} {formatAmount(b.base)}
                                </span>
                                <span>{formatAmount(b.vat)}</span>
                              </div>
                            ))}
                          </>
                        )}
                        {calc.rounding !== 0 && (
                          <div className="flex justify-between">
                            <span style={{ color: "rgb(107,117,133)" }}>{L("rounding")}</span>
                            <span>{formatAmount(calc.rounding)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-white" style={{ background: accent, height: "20pt", padding: "0 2pt 0 4pt", margin: "2pt -2pt 2pt -4pt", fontSize: "10pt", fontWeight: 700 }}>
                          <span>
                            {L("total_amount")} {currency}
                          </span>
                          <span>{formatAmount(calc.total)}</span>
                        </div>
                        {vatMode === "incl" &&
                          vatLines.map((b) => (
                            <p key={`${b.taxId}-${b.rate}`} className="text-right" style={{ fontSize: "7.5pt", lineHeight: "10pt", color: "rgb(107,117,133)" }}>
                              {L("vat_incl", { rate: formatDecimal(b.rate, 1) })}: {formatAmount(b.vat)}
                            </p>
                          ))}
                        {paid && (
                          <>
                            <div className="flex justify-between">
                              <span style={{ color: "rgb(107,117,133)" }}>{L("paid")}</span>
                              <span>- {formatAmount(sheet.amountPaid)}</span>
                            </div>
                            <div className="flex justify-between" style={{ fontSize: "9.5pt", fontWeight: 700, lineHeight: "16pt" }}>
                              <span>{L("open_amount")}</span>
                              <span>{formatAmount(sheet.amountOpen)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </Zone>
                  )}

                  {/* Closing text */}
                  <div className={cn("sheet-optional", !values.footer && "sheet-optional-empty")} data-editable={editable || undefined} style={{ marginTop: "10pt" }}>
                    <Inline label={field("footer")?.label ?? "Closing"} value={toStr(values.footer)} onChange={(v) => set("footer", v)} editable={editable} multiline placeholder={t("Add a closing text…")} style={{ fontSize: "9pt", lineHeight: 1.35 }} />
                  </div>
                </div>

                {stamp && (
                  <div className={cn("sheet-stamp", stamp.tone)} aria-hidden>
                    {stamp.text}
                  </div>
                )}
              </article>
            </div>
          </div>
        </div>
      </div>

      {editable && (
        <div className={cn("neu-toolbar sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-2 px-2 py-2 transition-all", !dirty && !isCreate && "opacity-80")}>
          <span className="text-muted-foreground px-2 text-xs">{dirty || isCreate ? t("Unsaved changes") : t("All saved")}</span>
          {dirty && !isCreate && (
            <button
              type="button"
              className="neu-button"
              onClick={() => {
                setValues(initialValues());
                setRows(toRows(initial.positions));
                setErrors({});
                setDirty(false);
              }}
            >
              <Undo2 /> {t("Discard")}
            </button>
          )}
          {sheet.pdfHref && !dirty && (
            <a className="neu-button" href={sheet.pdfHref} target="_blank" rel="noreferrer">
              <FileDown /> PDF
            </a>
          )}
          <button type="button" className="neu-button neu-button-primary" disabled={pending || (!dirty && !isCreate)} onClick={save}>
            {pending ? <Spinner /> : dirty || isCreate ? <Save /> : <Check />} {isCreate ? t("Create") : t("Save")}
            <kbd className="ml-1 hidden rounded px-1 text-[10px] opacity-70 sm:inline">⌘S</kbd>
          </button>
        </div>
      )}

      {lockReason && (
        <p className="text-muted-foreground text-center text-sm">{lockReason}</p>
      )}

      <div className="neu-card mx-auto max-w-3xl p-4">
        <p className="font-display text-sm font-semibold">{t("Notes for you")}</p>
        <p className="text-muted-foreground mb-2 text-xs">{t("Never printed.")}</p>
        <textarea
          className="border-input bg-background focus-visible:ring-ring/50 w-full resize-y rounded-lg border p-3 text-sm outline-none focus-visible:ring-3"
          rows={2}
          disabled={!editable}
          value={toStr(values.notes)}
          onChange={(e) => set("notes", e.target.value)}
          placeholder={t("Anything worth remembering about this document…")}
        />
      </div>
    </div>
  );
}
