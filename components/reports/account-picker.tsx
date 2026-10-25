"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefSelect } from "@/components/resource/ref-select";
import { useT } from "@/lib/i18n/client";

export function AccountPicker({ tenant, accountId, label }: { tenant: string; accountId: number | null; label: string | null }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="w-80">
      <RefSelect
        tenant={tenant}
        resource="accounts"
        value={accountId}
        label={label}
        placeholder={t("Choose an account…")}
        onChange={(id) => {
          const next = new URLSearchParams(params.toString());
          if (id) next.set("account", String(id));
          else next.delete("account");
          router.replace(`${pathname}?${next.toString()}`);
        }}
      />
    </div>
  );
}
