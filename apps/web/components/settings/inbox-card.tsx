"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { rotateInboxAction } from "@/app/(app)/[tenant]/settings/actions";
import { Batzi } from "@/components/fun/batzi";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@batzio/i18n/react";

/** Batzi's status and the company's private email address. */
export function InboxCard({ tenant, address, agent, canWrite }: { tenant: string; address: string | null; agent: boolean; canWrite: boolean }) {
  const t = useT();
  const [current, setCurrent] = useState(address);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <Batzi mood={agent ? "happy" : "sleepy"} className="size-14 shrink-0" />
      <div className="min-w-0 flex-1 space-y-4 text-sm">
        <div>
          <p className="font-medium">{agent ? t("Batzi is awake.") : t("Batzi is napping.")}</p>
          <p className="text-muted-foreground">
            {agent
              ? t("Drop files anywhere, paste screenshots, or tell Batzi what to change — company details, VAT, number formats, texts, your logo, the team.")
              : t("Quick sentences and spreadsheet/bank imports work without AI. To let Batzi read bills, receipts and screenshots, set ANTHROPIC_API_KEY on the server.")}
          </p>
        </div>
        <div>
          <p className="font-medium">{t("Inbox address")}</p>
          {current ? (
            <>
              <p className="text-muted-foreground">{t("Forward bills and receipts here, or give it to suppliers. Mail from team members can also contain instructions.")}</p>
              <div className="bg-muted/50 mt-2 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                <code className="font-mono text-xs font-semibold break-all">{current}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={async () => {
                    await navigator.clipboard.writeText(current);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check /> : <Copy />} {copied ? t("Copied") : t("Copy")}
                </Button>
                {canWrite && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await rotateInboxAction(tenant);
                        if (r.ok) {
                          setCurrent(r.address ?? null);
                          toast.success(r.message);
                        } else toast.error(r.error);
                      })
                    }
                  >
                    {pending ? <Spinner /> : <RefreshCw />} {t("New address")}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">{t("Not set up on this server yet: route a domain to Batzio with Cloudflare Email Routing and set EMAIL_DOMAIN.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
