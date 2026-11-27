"use client";

import { Bot, ShieldCheck, Undo2, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@ui-sdk/react/toast";
import { runRecordAction } from "@/app/(app)/[tenant]/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { HistoryChange, HistoryEntry } from "@batzio/server/history";
import { useT } from "@batzio/i18n/react";

const VISIBLE_CHANGES = 6;

function Change({ change }: { change: HistoryChange }) {
  return (
    <li className="grid grid-cols-[minmax(6rem,10rem)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
      <span className="text-muted-foreground truncate">{change.label}</span>
      <span className="min-w-0 break-words">
        {change.kind === "added" && <span className="text-success">+ {change.to}</span>}
        {change.kind === "removed" && <span className="text-destructive line-through decoration-1">− {change.from}</span>}
        {change.kind === "changed" && (
          <>
            {change.from !== null && <span className="text-destructive/80 line-through decoration-1">{change.from}</span>}
            {change.from !== null && <span className="text-muted-foreground mx-1.5">→</span>}
            <span className="text-success">{change.to ?? "–"}</span>
          </>
        )}
      </span>
    </li>
  );
}

function UndoButton({ tenant, entry }: { tenant: string; entry: HistoryEntry }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const undo = () =>
    start(async () => {
      const r = await runRecordAction(tenant, "audit_log", entry.id, "undo");
      setOpen(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? t("Change undone."));
      router.refresh();
    });
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={pending}>
        {pending ? <Spinner /> : <Undo2 />} {t("Undo")}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Undo this change?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("Puts the record back the way it was before this change (or removes what it created, or brings back what it deleted). Booked, issued or paid records are never rewritten.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={undo}>{t("Undo")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Entry({ tenant, entry, last }: { tenant: string; entry: HistoryEntry; last: boolean }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? entry.changes : entry.changes.slice(0, VISIBLE_CHANGES);
  const Who = entry.actor.automated ? Bot : User;
  return (
    <li className="relative flex gap-3 pb-5">
      {!last && <span className="bg-border absolute top-8 bottom-0 left-[0.9375rem] w-px" aria-hidden />}
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                "relative flex size-8 shrink-0 items-center justify-center rounded-full border",
                entry.actor.automated ? "bg-primary/10 text-primary border-primary/20" : "bg-card text-muted-foreground",
              )}
            />
          }
        >
          <Who className="size-4" aria-label={entry.actor.automated ? t("Software") : t("Person")} />
        </TooltipTrigger>
        <TooltipContent>{entry.actor.automated ? t("Software") : t("Person")}</TooltipContent>
      </Tooltip>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{entry.title}</span>
          <span className="text-muted-foreground text-sm">{entry.actor.name}</span>
          <Badge variant="outline" className="text-[11px]">
            {entry.actor.sourceLabel}
          </Badge>
          {entry.provenance.map((p) => (
            <Badge key={p.label} variant="secondary" className="max-w-full truncate text-[11px] font-normal">
              {p.label}
              {p.detail ? `: ${p.detail}` : ""}
            </Badge>
          ))}
          {entry.undo.undoneBy && <Badge variant="secondary" className="text-[11px]">{t("Undone in entry #{id}", { id: entry.undo.undoneBy })}</Badge>}
          {entry.undo.undoes && (
            <Link href={`/${tenant}/audit_log/${entry.undo.undoes}`} className="text-primary text-xs hover:underline">
              {t("Undoes entry #{id}", { id: entry.undo.undoes })}
            </Link>
          )}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          <Link href={`/${tenant}/audit_log/${entry.id}`} className="hover:underline">
            {entry.when}
          </Link>
          {entry.device && <span>· {entry.device}</span>}
          {entry.ip && <span className="num">· {entry.ip}</span>}
          {entry.sealed && (
            <Tooltip>
              <TooltipTrigger render={<ShieldCheck className="text-success size-3.5" aria-label={t("Sealed in the tamper-proof chain")} />} />
              <TooltipContent>{t("Sealed in the tamper-proof chain")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {shown.length > 0 && <ul className="bg-muted/40 space-y-1 rounded-lg border p-3">{shown.map((c, i) => <Change key={`${c.field}-${i}`} change={c} />)}</ul>}
        {entry.changes.length > VISIBLE_CHANGES && !all && (
          <button type="button" className="text-primary text-xs hover:underline" onClick={() => setAll(true)}>
            {t("Show all {n} changes", { n: entry.changes.length })}
          </button>
        )}
        {/* Its dialog renders in place; the div keeps this column's space-y margins off the backdrop. */}
        {entry.undo.possible && (
          <div>
            <UndoButton tenant={tenant} entry={entry} />
          </div>
        )}
      </div>
    </li>
  );
}

/** A record's history in words: who (person or software), from where, before → after, and undo. */
export function HistoryTimeline({ tenant, entries }: { tenant: string; entries: HistoryEntry[] }) {
  return (
    <ol>
      {entries.map((e, i) => (
        <Entry key={e.id} tenant={tenant} entry={e} last={i === entries.length - 1} />
      ))}
    </ol>
  );
}
