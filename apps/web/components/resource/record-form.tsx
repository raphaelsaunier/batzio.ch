"use client";

import { Lock, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "@ui-sdk/react/toast";
import { saveRecordAction } from "@/app/(app)/[tenant]/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { ClientResource } from "@batzio/server/resources/client";
import type { ChildDef, FieldDef } from "@batzio/server/resources/types";
import { cn } from "@/lib/utils";
import { ChildrenEditor, newKey, SummaryLine, type ChildRow } from "./children-editor";
import { FieldInput, type FormLabels, type FormValues } from "./field-input";
import { PositionsEditor, type TaxOption } from "./positions-editor";
import { useT } from "@batzio/i18n/react";
import { TermHint } from "@/components/i18n/term";

const SPAN: Record<number, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-3",
  4: "sm:col-span-4",
  6: "sm:col-span-6",
};

const SKIP = new Set(["id", "created_at", "updated_at", "created_by", "updated_by"]);

function editableFields(resource: ClientResource) {
  return resource.fields.filter((f) => !SKIP.has(f.name) && !f.hidden && !f.readOnly);
}

function groupSections(fields: FieldDef[]) {
  const sections: { title: string | null; fields: FieldDef[] }[] = [];
  for (const f of fields) {
    if (f.section || sections.length === 0) sections.push({ title: f.section ?? null, fields: [] });
    sections[sections.length - 1].fields.push(f);
  }
  return sections.filter((s) => s.fields.length);
}

function toRows(rows: unknown): ChildRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row: ChildRow = { _key: newKey() };
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) row[k] = typeof v === "number" ? String(v) : v;
    return row;
  });
}

function cleanRows(child: ChildDef, rows: ChildRow[]) {
  const writable = new Set(child.fields.filter((f) => !f.readOnly).map((f) => f.name));
  return rows.map((r, i) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (writable.has(k) && k !== "id") out[k] = v === "" ? null : v;
    if (writable.has("sort")) out.sort = i;
    return out;
  });
}

export interface RecordFormProps {
  tenant: string;
  resource: ClientResource;
  recordId?: number;
  initial: FormValues;
  labels: FormLabels;
  lockReason?: string | null;
  canWrite: boolean;
  taxes?: TaxOption[];
  rounding?: Record<string, number>;
}

export function RecordForm({ tenant, resource, recordId, initial, labels: initialLabels, lockReason, canWrite, taxes = [], rounding = {} }: RecordFormProps) {
  const t = useT();
  const router = useRouter();
  const initialValues = () => {
    const v: FormValues = {};
    for (const [k, val] of Object.entries(initial)) v[k] = typeof val === "number" ? String(val) : val;
    return v;
  };
  const initialChildren = () => Object.fromEntries(resource.children.map((c) => [c.name, toRows(initial[c.name])]));
  const [values, setValues] = useState<FormValues>(initialValues);
  const [children, setChildren] = useState<Record<string, ChildRow[]>>(initialChildren);
  const [labels, setLabels] = useState<FormLabels>(initialLabels);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // After a failed save, focus the first rejected field so its label and error are read out.
  const form = useRef<HTMLFormElement>(null);
  const focusError = useRef(false);
  useEffect(() => {
    if (!focusError.current) return;
    focusError.current = false;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const disabled = !canWrite || !!lockReason || resource.readOnly;
  const isCreate = !recordId;

  const fields = useMemo(() => editableFields(resource), [resource]);
  const sections = useMemo(() => groupSections(fields), [fields]);

  const setValue = (name: string, value: unknown) => {
    setValues((v) => ({ ...v, [name]: value }));
    setDirty(true);
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };
  const setLabelsFor = (key: string, l: Record<string, string>) => setLabels((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...l } }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      if (!isCreate && f.createOnly) continue;
      const v = values[f.name];
      payload[f.name] = v === "" ? null : v;
    }
    for (const c of resource.children) payload[c.name] = cleanRows(c, children[c.name] ?? []);
    start(async () => {
      const r = await saveRecordAction(tenant, resource.name, recordId ?? null, payload);
      if (!r.ok) {
        focusError.current = true;
        setErrors(r.fields ?? {});
        toast.error(r.error ?? t("Could not save."));
        return;
      }
      setDirty(false);
      toast.success(r.message);
      if (isCreate) router.push(`/${tenant}/${resource.name}/${r.id}`);
      else router.refresh();
    });
  };

  const vatMode = (values.vat_mode as "excl" | "incl" | "none") ?? "excl";
  const currency = String(values.currency_code ?? "CHF");

  const renderChild = (child: ChildDef) => {
    const rows = children[child.name] ?? [];
    const onChange = (next: ChildRow[]) => {
      setChildren((c) => ({ ...c, [child.name]: next }));
      setDirty(true);
    };
    if (resource.view === "document" && child.name === "positions") {
      return (
        <PositionsEditor
          key={child.name}
          rows={rows}
          onChange={onChange}
          tenant={tenant}
          labels={labels}
          onLabels={setLabelsFor}
          disabled={disabled}
          vatMode={vatMode}
          currency={currency}
          rounding={rounding[currency] ?? 0.01}
          taxes={taxes}
          purchase={resource.name === "purchase_orders"}
        />
      );
    }
    const footer =
      child.name === "lines" ? (
        <div className="min-w-56 space-y-1">
          <SummaryLine
            label={resource.name === "bills" ? (values.vat_mode === "excl" ? t("Total excl. VAT") : t("Total incl. VAT")) : t("Total")}
            value={rows.reduce((s, r) => s + Math.round(Number(String(r.amount ?? 0).replace(",", ".")) * 100 || 0), 0)}
            strong
          />
        </div>
      ) : null;
    return (
      <ChildrenEditor
        key={child.name}
        child={child}
        rows={rows}
        onChange={onChange}
        tenant={tenant}
        labels={labels}
        onLabels={setLabelsFor}
        disabled={disabled}
        errors={errors}
        footer={footer}
      />
    );
  };

  return (
    <form ref={form} onSubmit={submit} className="space-y-5">
      {lockReason && (
        <Alert>
          <Lock />
          <AlertDescription>{lockReason}</AlertDescription>
        </Alert>
      )}
      {sections.map((section, si) => (
        <div key={si} className="space-y-5">
          <Card className="gap-4 py-5 shadow-xs">
            {section.title && (
              <CardHeader className="px-5">
                <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</CardTitle>
              </CardHeader>
            )}
            <CardContent className="grid grid-cols-1 gap-x-4 gap-y-4 px-5 sm:grid-cols-6">
              {section.fields.map((f) => {
                const id = `f-${f.name}`;
                return (
                  <Field key={f.name} invalid={errors[f.name] ? true : undefined} className={cn("col-span-1", SPAN[f.span ?? 3] ?? "sm:col-span-3")}>
                    <FieldLabel htmlFor={id} className="text-xs font-medium text-muted-foreground">
                      {f.label}
                      {f.required && <span className="text-destructive">*</span>}
                      {f.term && <TermHint id={f.term} />}
                    </FieldLabel>
                    <FieldInput
                      id={id}
                      field={f}
                      value={values[f.name]}
                      onChange={(v) => setValue(f.name, v)}
                      tenant={tenant}
                      labels={labels}
                      onLabels={setLabelsFor}
                      disabled={disabled || (!isCreate && !!f.createOnly)}
                      invalid={!!errors[f.name]}
                    />
                    {errors[f.name] ? <FieldError>{errors[f.name]}</FieldError> : f.type === "json" && f.description ? <FieldDescription className="text-xs">{f.description}</FieldDescription> : null}
                  </Field>
                );
              })}
            </CardContent>
          </Card>
          {si === 0 && resource.children.map(renderChild)}
        </div>
      ))}
      {sections.length === 0 && resource.children.map(renderChild)}
      {!disabled && (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">{t("Unsaved changes")}</span>}
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (isCreate) return router.back();
              setValues(initialValues());
              setChildren(initialChildren());
              setErrors({});
              setDirty(false);
            }}
          >
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : <Save />} {isCreate ? t("Create") : t("Save changes")}
          </Button>
        </div>
      )}
    </form>
  );
}
