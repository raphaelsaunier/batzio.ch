"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { runPayrollAction } from "@/app/(app)/[tenant]/ops-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useLocale, useT } from "@/lib/i18n/client";
import { monthName } from "@/lib/i18n";


export function PayrollRunForm({ tenant, year, month }: { tenant: string; year: number; month: number }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [y, setY] = useState(String(year));
  const [m, setM] = useState(String(month));
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await runPayrollAction(tenant, Number(y), Number(m));
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          if (r.redirect) router.push(r.redirect);
        });
      }}
    >
      <Field className="w-auto">
        <FieldLabel>{t("Month")}</FieldLabel>
        <Select value={m} onValueChange={setM}>
          <SelectTrigger className="w-40 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => (
              <SelectItem key={i} value={String(i + 1)}>
                {monthName(i + 1, locale, "long")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field className="w-auto">
        <FieldLabel>{t("Year")}</FieldLabel>
        <Select value={y} onValueChange={setY}>
          <SelectTrigger className="w-28 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[year - 1, year, year + 1].map((v) => (
              <SelectItem key={v} value={String(v)}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : <Play />} {t("Create payslips")}
      </Button>
    </form>
  );
}
