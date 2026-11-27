"use client";

import { ImageUp, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@ui-sdk/react/toast";
import { saveRecordAction, type ActionResponse } from "@/app/(app)/[tenant]/actions";
import { saveSettingsAction, setLogoAction } from "@/app/(app)/[tenant]/settings/actions";
import { useBatzi } from "@/components/batzi/batzi-provider";
import { FieldInput } from "@/components/resource/field-input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useT } from "@batzio/i18n/react";
import type { FieldDef } from "@batzio/server/resources/types";
import type { SheetBank, SheetCompany, SheetContext } from "./document-sheet";

/**
 * The parts of a sheet that belong to the company rather than the document
 * (letterhead, page footer, bank account): edited in place like the rest and
 * previewed live, but saved to the company settings, so every document
 * prints them from then on.
 */

/** Fields of each panel with their width on a six-column grid. */
export const LETTERHEAD_FIELDS: [string, number][] = [
  ["name", 4],
  ["legal_form", 2],
  ["street", 4],
  ["house_number", 2],
  ["postcode", 2],
  ["city", 3],
  ["country_code", 1],
  ["phone", 3],
  ["email", 3],
  ["website", 6],
  ["accent_color", 6],
];
export const FOOTER_FIELDS: [string, number][] = [
  ["document_footer", 6],
  ["vat_number", 6],
];
export const BANK_FIELDS: [string, number][] = [
  ["name", 3],
  ["bank_name", 3],
  ["iban", 6],
  ["qr_iban", 6],
  ["bic", 3],
];

const SPAN: Record<number, string> = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4", 5: "col-span-5", 6: "col-span-6" };
const NEW_BANK: SheetBank = { id: 0, name: "", bank_name: null, iban: null, qr_iban: null, bic: null };

interface Draft {
  /** The sheet the draft was started on: fresh settings from the server end it. */
  base: SheetContext;
  company?: SheetCompany;
  bank?: SheetBank;
  errors: Record<string, string>;
  /** Saved and waiting for the refreshed sheet, so closing the panel keeps it on screen. */
  saved?: boolean;
}

/** Company and bank details as the sheet should show them right now, plus their editing. */
export function useCompanyParts(tenant: string, sheet: SheetContext, bankId: number | null, onBankCreated: (id: number) => void) {
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();
  const live = draft?.base === sheet ? draft : null;

  const chosen = sheet.banks.find((b) => b.id === bankId) ?? sheet.banks[0] ?? null;
  const company = live?.company ?? sheet.company;
  const bank = live?.bank && live.bank.id === (chosen?.id ?? 0) ? live.bank : chosen;

  const edit = (patch: (d: Draft) => Partial<Draft>, name: string) =>
    setDraft((d) => {
      const current: Draft = d?.base === sheet ? d : { base: sheet, errors: {} };
      const { [name]: _, ...errors } = current.errors;
      return { ...current, ...patch(current), errors, saved: false };
    });
  const editCompany = (name: string, value: unknown) => edit((d) => ({ company: { ...(d.company ?? sheet.company), [name]: value ?? "" } }), name);
  const editBank = (name: string, value: unknown) =>
    edit((d) => ({ bank: { ...(d.bank && d.bank.id === (chosen?.id ?? 0) ? d.bank : (chosen ?? NEW_BANK)), [name]: value === "" ? null : value } }), name);
  /** Closing a panel without saving puts the sheet back. */
  const discard = () => setDraft((d) => (d?.saved ? d : null));

  const finish = (r: ActionResponse, close: () => void, message?: string) => {
    if (!r.ok) {
      setDraft((d) => (d ? { ...d, errors: r.fields ?? {} } : d));
      toast.error(r.error ?? t("Could not save."));
      return false;
    }
    setDraft((d) => (d ? { ...d, saved: true } : d));
    toast.success(message ?? r.message);
    close();
    router.refresh();
    return true;
  };

  const saveCompany = (fields: [string, number][], close: () => void) => {
    if (!live?.company) return close();
    const values = Object.fromEntries(fields.map(([name]) => [name, live.company![name as keyof SheetCompany]]));
    start(async () => {
      finish(await saveSettingsAction(tenant, "company", values), close, t("Saved for all documents."));
    });
  };

  const saveBank = (close: () => void) => {
    const b = live?.bank;
    if (!b) return close();
    const payload = { name: b.name, bank_name: b.bank_name, iban: b.iban, qr_iban: b.qr_iban, bic: b.bic, ...(b.id ? {} : { is_default: sheet.banks.length === 0 }) };
    start(async () => {
      const r = await saveRecordAction(tenant, "bank_accounts", b.id || null, payload);
      if (finish(r, close) && !b.id && r.id) onBankCreated(r.id);
    });
  };

  return {
    company,
    bank,
    /** The document's account as saved, before any edits here. */
    savedBank: chosen,
    errors: live?.errors ?? {},
    dirty: { company: !!live?.company && !live.saved, bank: !!live?.bank && !live.saved },
    pending,
    editCompany,
    editBank,
    discard,
    saveCompany,
    saveBank,
  };
}

/**
 * Pickers open their list in place, inside the label around them, so a press in the list would
 * also press the label's control and open the list again. Labels around a field call this on click.
 */
export function ignorePopupClicks(e: React.MouseEvent<HTMLElement>) {
  const popup = e.target instanceof Element ? e.target.closest("[popover]") : null;
  if (popup && !popup.contains(e.currentTarget)) e.preventDefault();
}

/** Settings fields on a six-column grid, with their hint or error underneath. */
export function SettingsFields({
  tenant,
  fields,
  layout,
  values,
  errors,
  onChange,
  disabled,
}: {
  tenant: string;
  fields: FieldDef[];
  layout: [string, number][];
  values: object;
  errors: Record<string, string>;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const v = values as Record<string, unknown>;
  return (
    <div className="grid grid-cols-6 gap-x-3 gap-y-2.5">
      {layout.map(([name, span]) => {
        const field = byName.get(name);
        if (!field) return null;
        return (
          <label key={name} className={cn("flex min-w-0 flex-col gap-1", SPAN[span])} onClick={ignorePopupClicks}>
            <span className="text-muted-foreground block truncate text-xs font-medium">{field.label}</span>
            <FieldInput id={`sheet-${name}`} field={field} value={v[name]} onChange={(value) => onChange(name, value)} tenant={tenant} invalid={!!errors[name]} disabled={disabled} />
            {errors[name] ? <span className="text-destructive block text-xs">{errors[name]}</span> : field.description ? <span className="text-muted-foreground block text-xs">{field.description}</span> : null}
          </label>
        );
      })}
    </div>
  );
}

/** “Applies to every document” and the save button at the foot of a panel. */
export function SaveForAll({ note, pending, dirty, onSave }: { note: string; pending: boolean; dirty: boolean; onSave: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-3">
      <p className="text-muted-foreground text-xs">{note}</p>
      <button type="button" className="neu-button neu-button-primary shrink-0" disabled={pending || !dirty} onClick={onSave}>
        {pending ? <Spinner /> : <Save />} {t("Save")}
      </button>
    </div>
  );
}

/** Upload, replace or remove the logo printed top left (saved right away). */
export function LogoField({ tenant, logoUrl, disabled }: { tenant: string; logoUrl: string | null; disabled?: boolean }) {
  const t = useT();
  const router = useRouter();
  const { upload } = useBatzi();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const change = (file: File | null) =>
    start(async () => {
      try {
        const id = file ? ((await upload([file]))[0]?.id ?? null) : null;
        if (file && !id) throw new Error(t("Could not save."));
        const r = await setLogoAction(tenant, id);
        if (!r.ok) {
          toast.error(r.error ?? t("Could not save."));
          return;
        }
        toast.success(r.message);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-11 w-28 shrink-0 items-center justify-center rounded-lg border bg-white p-1">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={t("Logo")} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-slate-500">{t("No logo")}</span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (file) change(file);
        }}
      />
      <button type="button" className="neu-button" disabled={disabled || pending} onClick={() => input.current?.click()}>
        {pending ? <Spinner /> : <ImageUp />} {logoUrl ? t("Replace logo") : t("Upload logo")}
      </button>
      {logoUrl && (
        <button type="button" className="neu-button" disabled={disabled || pending} aria-label={t("Remove logo")} title={t("Remove logo")} onClick={() => change(null)}>
          <Trash2 />
        </button>
      )}
    </div>
  );
}
