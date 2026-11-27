"use client";

import { BellRing, Copy, FileDown, Repeat, ShieldCheck, Upload, Banknote } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@ui-sdk/react/toast";
import type { ActionResponse } from "@/app/(app)/[tenant]/actions";
import { remindOverdueAction, runRecurringAction, scanDuplicatesAction, verifyAuditAction } from "@/app/(app)/[tenant]/ops-actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@batzio/i18n/react";

function OpButton({ label, icon, run }: { label: string; icon: React.ReactNode; run: () => Promise<ActionResponse> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await run();
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
          if (r.redirect) router.push(r.redirect);
          else router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : icon} {label}
    </Button>
  );
}

/** Resource-specific bulk operations shown in list headers. */
export function ListExtras({ tenant, resource }: { tenant: string; resource: string }) {
  const t = useT();
  switch (resource) {
    case "invoices":
      return <OpButton label={t("Remind overdue")} icon={<BellRing />} run={() => remindOverdueAction(tenant)} />;
    case "orders":
      return <OpButton label={t("Run recurring billing")} icon={<Repeat />} run={() => runRecurringAction(tenant)} />;
    case "audit_log":
      return <OpButton label={t("Verify integrity")} icon={<ShieldCheck />} run={() => verifyAuditAction(tenant)} />;
    case "duplicates":
      return <OpButton label={t("Look for duplicates")} icon={<Copy />} run={() => scanDuplicatesAction(tenant)} />;
    case "bank_transactions":
      return (
        <Button variant="outline" render={<Link href={`/${tenant}/banking/import`} />}>
          <Upload /> {t("Import statement")}
        </Button>
      );
    case "outgoing_payments":
      return (
        <Button variant="outline" render={<Link href={`/${tenant}/banking/import#pain001`} />}>
          <FileDown /> Export pain.001
        </Button>
      );
    case "payslips":
    case "employees":
      return (
        <Button variant="outline" render={<Link href={`/${tenant}/payroll`} />}>
          <Banknote /> Payroll run
        </Button>
      );
    default:
      return null;
  }
}
