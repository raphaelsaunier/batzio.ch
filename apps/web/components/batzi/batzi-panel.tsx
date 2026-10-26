"use client";

import { History, SquarePen } from "lucide-react";
import { useState } from "react";
import { listThreadsAction } from "@/app/(app)/[tenant]/agent-actions";
import { Batzi } from "@/components/fun/batzi";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDateTime } from "@batzio/core/format";
import { useT } from "@batzio/i18n/react";
import { useBatzi } from "./batzi-provider";
import { Composer, ExampleChips } from "./composer";
import { Conversation } from "./conversation";

function ThreadMenu() {
  const t = useT();
  const { tenant, openThread } = useBatzi();
  const [threads, setThreads] = useState<Awaited<ReturnType<typeof listThreadsAction>>>([]);
  return (
    <DropdownMenu onOpenChange={(open) => open && listThreadsAction(tenant).then(setThreads)}>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t("Earlier conversations")}>
          <History />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("Earlier conversations")}</DropdownMenuLabel>
        {threads.length === 0 && <p className="text-muted-foreground px-2 py-1.5 text-xs">{t("Nothing yet.")}</p>}
        {threads.map((th) => (
          <DropdownMenuItem key={th.id} onSelect={() => openThread(th.id)} className="flex-col items-start gap-0">
            <span className="w-full truncate text-sm">{th.title || t("Files")}</span>
            <span className="text-muted-foreground text-[11px]">{formatDateTime(th.last)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EmptyChat() {
  const t = useT();
  const { agent } = useBatzi();
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
      <Batzi mood="wave" className="size-16" />
      <div>
        <p className="font-display text-lg font-semibold">{t("Grüezi! I’m Batzi.")}</p>
        <p className="text-muted-foreground mx-auto max-w-xs text-sm">
          {agent
            ? t("Tell me what happened — “Anna paid”, “I bought a laptop”, “change the invoice footer” — or drop a bill, a receipt, a statement, a spreadsheet or a screenshot.")
            : t("I understand quick sentences right away. Add an Anthropic API key and I’ll read bills, receipts and screenshots too.")}
        </p>
      </div>
      <ExampleChips />
    </div>
  );
}

/** Batzi, everywhere: a side panel that follows you around the app. */
export function BatziPanel() {
  const t = useT();
  const { open, setOpen, turns, live, newThread } = useBatzi();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[460px]" showCloseButton={false}>
        <SheetHeader className="flex-row items-center gap-2 border-b px-4 py-3">
          <Batzi mood="happy" className="size-8" />
          <div className="min-w-0 flex-1">
            <SheetTitle className="font-display">Batzi</SheetTitle>
            <SheetDescription className="text-xs">{t("Your bookkeeper. Allergic to jargon.")}</SheetDescription>
          </div>
          <ThreadMenu />
          <Button size="icon-sm" variant="ghost" aria-label={t("New conversation")} onClick={newThread}>
            <SquarePen />
          </Button>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Conversation turns={turns} live={live} empty={<EmptyChat />} />
        </div>
        <div className="border-t p-3">
          <Composer autoFocus compact />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Full-window overlay while files are dragged over the app. */
export function DropOverlay() {
  const t = useT();
  const { dragging } = useBatzi();
  if (!dragging) return null;
  return (
    <div className="bg-background/70 animate-in fade-in pointer-events-none fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm">
      <div className="border-primary/50 bg-card/90 mx-4 flex max-w-md flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-10 py-9 text-center shadow-2xl">
        <Batzi mood="party" className="size-20 animate-bounce [animation-duration:1.2s]" />
        <p className="font-display text-2xl font-bold">{t("Drop it like it’s hot")}</p>
        <p className="text-muted-foreground text-sm">{t("Bills, receipts, bank statements, spreadsheets, logos, screenshots — Batzi sorts it out.")}</p>
      </div>
    </div>
  );
}
