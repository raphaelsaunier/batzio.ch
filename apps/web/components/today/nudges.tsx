"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { dismissInboxAction } from "@/app/(app)/[tenant]/agent-actions";
import { runRecordAction } from "@/app/(app)/[tenant]/actions";
import { remindOverdueAction } from "@/app/(app)/[tenant]/ops-actions";
import { useBatzi } from "@/components/batzi/batzi-provider";
import { Batzi } from "@/components/fun/batzi";
import { confetti } from "@/components/fun/confetti";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@batzio/core/format";
import { useT } from "@batzio/i18n/react";
import type { NudgeActionKind } from "@batzio/server/nudges";
import { cn } from "@/lib/utils";

export interface ClientNudgeAction {
  kind: NudgeActionKind;
  label: string;
  href?: string;
  resource?: string;
  id?: number;
  action?: string;
  prompt?: string;
  fileId?: number | null;
  inboxId?: number;
  primary?: boolean;
  agent?: boolean;
}

export interface ClientNudge {
  key: string;
  icon: string;
  tone: "info" | "warning" | "danger" | "success";
  title: string;
  text?: string;
  amount?: number;
  actions: ClientNudgeAction[];
}

const TONE: Record<ClientNudge["tone"], string> = {
  info: "bg-primary/10 text-primary",
  warning: "bg-warning/15 text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning",
  danger: "bg-destructive/10 text-destructive",
  success: "bg-success/12 text-success",
};

function NudgeCard({ nudge }: { nudge: ClientNudge }) {
  const t = useT();
  const router = useRouter();
  const { tenant, agent, ask } = useBatzi();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  if (gone) return null;

  const run = (a: ClientNudgeAction) => {
    setActive(a.label);
    start(async () => {
      if (a.kind === "ask" && a.prompt) {
        await ask(a.prompt);
      } else if (a.kind === "process_inbox") {
        await ask("", { fileIds: a.fileId ? [a.fileId] : [], inboxIds: a.inboxId ? [a.inboxId] : [] });
      } else if (a.kind === "dismiss_inbox" && a.inboxId) {
        await dismissInboxAction(tenant, a.inboxId);
        setGone(true);
      } else if (a.kind === "record_action" && a.resource && a.id && a.action) {
        const res = await runRecordAction(tenant, a.resource, a.id, a.action);
        if (res.ok) {
          toast.success(res.message ?? t("Done."));
          confetti({ count: 40 });
          setGone(true);
        } else toast.error(res.error);
      } else if (a.kind === "remind_overdue") {
        const res = await remindOverdueAction(tenant);
        if (res.ok) {
          toast.success(res.message ?? t("Done."));
          setGone(true);
        } else toast.error(res.error);
      }
      router.refresh();
      setActive(null);
    });
  };

  const actions = nudge.actions.filter((a) => agent || !a.agent);
  return (
    <div className="bg-card group flex gap-3 rounded-2xl border p-4 shadow-xs transition-shadow hover:shadow-md">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", TONE[nudge.tone])}>
        <Icon name={nudge.icon} className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display leading-snug font-semibold">{nudge.title}</p>
          {nudge.amount !== undefined && <span className="num text-muted-foreground shrink-0 text-sm">CHF {formatAmount(nudge.amount)}</span>}
        </div>
        {nudge.text && <p className="text-muted-foreground mt-0.5 line-clamp-3 text-sm">{nudge.text}</p>}
        {actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((a) =>
              a.kind === "link" && a.href ? (
                <Button key={a.label} size="sm" variant={a.primary ? "default" : "ghost"} asChild>
                  <Link href={a.href} target={a.href.startsWith("/api/") ? "_blank" : undefined}>
                    {a.label}
                  </Link>
                </Button>
              ) : (
                <Button key={a.label} size="sm" variant={a.primary ? "default" : "ghost"} disabled={pending} onClick={() => run(a)}>
                  {pending && active === a.label && <Loader2 className="animate-spin" />}
                  {a.label}
                </Button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function NudgeList({ nudges }: { nudges: ClientNudge[] }) {
  const t = useT();
  if (!nudges.length) {
    return (
      <div className="bg-card/60 flex items-center gap-4 rounded-2xl border border-dashed p-6">
        <Batzi mood="cool" className="size-14 shrink-0" />
        <div>
          <p className="font-display text-lg font-semibold">{t("All clear. Nothing needs you.")}</p>
          <p className="text-muted-foreground text-sm">{t("Go outside. Batzi will hold the fort.")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {nudges.map((n) => (
        <NudgeCard key={n.key} nudge={n} />
      ))}
    </div>
  );
}
