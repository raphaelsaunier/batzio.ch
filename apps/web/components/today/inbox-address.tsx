"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";
import { useT } from "@batzio/i18n/react";

/** The company's private email address: forward bills and receipts, Batzi does the rest. */
export function InboxAddress({ address }: { address: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-background/60 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-dashed px-3 py-2 text-sm">
      <Mail className="text-primary size-4" />
      <span className="text-muted-foreground">{t("Forward bills and receipts to")}</span>
      <code className="font-mono text-xs font-semibold break-all">{address}</code>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs"
        onClick={async () => {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? t("Copied") : t("Copy")}
      </button>
    </div>
  );
}
