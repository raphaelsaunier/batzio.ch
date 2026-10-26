"use client";

import { FileDown, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { importStatementAction } from "@/app/(app)/[tenant]/ops-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useT } from "@batzio/i18n/react";

interface Bank {
  id: number;
  name: string;
  iban: string | null;
  open: number;
}

export function StatementImportForm({ tenant, banks }: { tenant: string; banks: Bank[] }) {
  const t = useT();
  const router = useRouter();
  const [bank, setBank] = useState(banks[0] ? String(banks[0].id) : "");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      action={(form) =>
        start(async () => {
          form.set("bank_account_id", bank);
          const r = await importStatementAction(tenant, form);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          if (r.redirect) router.push(r.redirect);
        })
      }
    >
      <Field>
        <FieldLabel htmlFor="file">{t("Statement file")}</FieldLabel>
        <Input id="file" name="file" type="file" accept=".xml,.camt,.csv,.txt" required className="bg-background" />
        <FieldDescription>{t("ISO 20022 camt.053 / camt.054 (XML) from any Swiss bank, or CSV with date;amount;text;reference.")}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>{t("Bank account")}</FieldLabel>
        <Select value={bank} onValueChange={setBank}>
          <SelectTrigger className="w-full bg-background">
            <SelectValue placeholder={t("Detect from IBAN")} />
          </SelectTrigger>
          <SelectContent>
            {banks.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>
                {b.name}
                {b.iban ? ` · ${b.iban}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field orientation="horizontal">
        <Switch id="auto_book" name="auto_book" defaultChecked />
        <FieldLabel htmlFor="auto_book" className="font-normal">
          {t("Book payments with an exact QR reference automatically")}
        </FieldLabel>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : <Upload />} {t("Import")}
      </Button>
    </form>
  );
}

export function PaymentExportForm({ tenant, banks }: { tenant: string; banks: Bank[] }) {
  const t = useT();
  const router = useRouter();
  const withPayments = banks.filter((b) => b.open > 0);
  const [bank, setBank] = useState(withPayments[0] ? String(withPayments[0].id) : banks[0] ? String(banks[0].id) : "");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel>{t("Debit account")}</FieldLabel>
        <Select value={bank} onValueChange={setBank}>
          <SelectTrigger className="w-full bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {banks.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>
                {b.name} — {b.open} open payment{b.open === 1 ? "" : "s"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button
        disabled={pending || !bank}
        onClick={() =>
          start(async () => {
            const res = await fetch(`/api/v1/banking/pain001?tenant=${tenant}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bank_account_id: Number(bank) }),
            });
            if (!res.ok) {
              const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
              return void toast.error(body?.error?.message ?? t("Export failed."));
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "payments.xml";
            a.click();
            URL.revokeObjectURL(url);
            toast.success(t("Payment file created. Upload it to your e-banking."));
            router.refresh();
          })
        }
      >
        {pending ? <Spinner /> : <FileDown />} Download pain.001
      </Button>
    </div>
  );
}
