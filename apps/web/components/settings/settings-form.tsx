"use client";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSequenceAction, saveSettingsAction } from "@/app/(app)/[tenant]/settings/actions";
import { FieldInput } from "@/components/resource/field-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { FieldDef } from "@batzio/server/resources/types";
import { cn } from "@/lib/utils";
import { useT } from "@batzio/i18n/react";
import { TermHint } from "@/components/i18n/term";

const SPAN: Record<number, string> = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" };

export function SettingsForm({
  tenant,
  group,
  fields,
  initial,
  disabled,
}: {
  tenant: string;
  group: "company" | "accounting" | "texts";
  fields: FieldDef[];
  initial: Record<string, unknown>;
  disabled?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveSettingsAction(tenant, group, values);
          if (r.ok) {
            toast.success(r.message);
            router.refresh();
          } else toast.error(r.error);
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        {fields.map((f) => (
          <Field key={f.name} className={cn(SPAN[f.span ?? 3])}>
            <FieldLabel htmlFor={`s-${f.name}`} className="text-xs font-medium text-muted-foreground">
              {f.label}
              {f.term && <TermHint id={f.term} />}
            </FieldLabel>
            <FieldInput
              id={`s-${f.name}`}
              field={f}
              value={values[f.name]}
              onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
              tenant={tenant}
              disabled={disabled}
            />
            {f.description && <FieldDescription className="text-xs">{f.description}</FieldDescription>}
          </Field>
        ))}
      </div>
      {!disabled && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : <Save />} {t("Save")}
          </Button>
        </div>
      )}
    </form>
  );
}

export function SequenceRow({
  tenant,
  sequenceKey,
  label,
  format,
  nextValue,
  preview,
  disabled,
}: {
  tenant: string;
  sequenceKey: string;
  label: string;
  format: string;
  nextValue: number;
  preview: string;
  disabled?: boolean;
}) {
  const t = useT();
  const [fmt, setFmt] = useState(format);
  const [next, setNext] = useState(String(nextValue));
  const [pending, start] = useTransition();
  const dirty = fmt !== format || next !== String(nextValue);
  return (
    <div className="grid grid-cols-1 items-center gap-2 border-t py-2.5 first:border-t-0 sm:grid-cols-[12rem_1fr_7rem_10rem_auto]">
      <span className="text-sm font-medium">{label}</span>
      <Input value={fmt} onChange={(e) => setFmt(e.target.value)} disabled={disabled} className="h-8 font-mono" />
      <Input value={next} onChange={(e) => setNext(e.target.value)} disabled={disabled} inputMode="numeric" className="h-8 text-right num" />
      <span className="font-mono text-xs text-muted-foreground">{preview}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={!dirty || pending || disabled}
        onClick={() =>
          start(async () => {
            const r = await saveSequenceAction(tenant, sequenceKey, fmt, Number(next));
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
          })
        }
      >
        {pending ? <Spinner /> : t("Save")}
      </Button>
    </div>
  );
}
