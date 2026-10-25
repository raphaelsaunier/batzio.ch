"use client";

import { AlertTriangle, ArrowUpRight, Check, FileText, ImageIcon, Loader2, ShieldQuestion, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Batzi } from "@/components/fun/batzi";
import { Button } from "@/components/ui/button";
import type { ToolOutcome, UiTurn } from "@/lib/agent/threads";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { useBatzi, type LiveTurn } from "./batzi-provider";
import { Markdown } from "./markdown";

function FileChip({ file }: { file: { id: number; name: string; mime: string | null } }) {
  const Icon = file.mime?.startsWith("image/") ? ImageIcon : FileText;
  return (
    <span className="bg-background/70 inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="truncate">{file.name}</span>
    </span>
  );
}

const humanize = (key: string) => key.replace(/_id$/, "").replace(/_/g, " ");

function describeInput(input: Record<string, unknown> | undefined): [string, string][] {
  if (!input) return [];
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 6)
    .map(([k, v]) => [humanize(k), typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v)]);
}

function ToolChip({ outcome, live }: { outcome: ToolOutcome; live?: boolean }) {
  const t = useT();
  const { tenant, confirm, busy } = useBatzi();
  const running = live && outcome.summary === "…";
  if (outcome.pending) {
    return (
      <div className="border-warning/40 bg-warning/8 rounded-xl border p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <ShieldQuestion className="text-warning size-4" />
          {t("Batzi needs your OK: {action}", { action: t(outcome.title) })}
        </div>
        {describeInput(outcome.input).length > 0 && (
          <dl className="text-muted-foreground mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {describeInput(outcome.input).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="capitalize">{t(k)}</dt>
                <dd className="text-foreground truncate font-mono">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => confirm(outcome.id, true)}>
            <Check /> {t("Yes, do it")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm(outcome.id, false)}>
            <X /> {t("No")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2 rounded-lg px-2 py-1 text-xs", outcome.ok ? "bg-secondary/70" : "bg-destructive/8 text-destructive")}>
      {running ? <Loader2 className="size-3.5 animate-spin" /> : outcome.ok ? <Check className="text-success size-3.5" /> : <AlertTriangle className="size-3.5" />}
      <span className="font-medium">{t(outcome.title)}</span>
      {!running && outcome.summary && <span className="text-muted-foreground truncate">{outcome.summary === "Declined" ? t("Declined") : outcome.summary}</span>}
      {outcome.record && (
        <Link href={`/${tenant}/${outcome.record.resource}/${outcome.record.id}`} className="text-primary ml-auto inline-flex shrink-0 items-center gap-0.5 font-medium hover:underline">
          {outcome.record.label || t("Open")}
          <ArrowUpRight className="size-3" />
        </Link>
      )}
    </div>
  );
}

function AssistantBubble({ text, updates, tools, refused, error, noAgent, live }: { text: string; updates?: string[]; tools?: ToolOutcome[]; refused?: boolean; error?: string; noAgent?: boolean; live?: boolean }) {
  const t = useT();
  const working = live && !text && !error && !noAgent;
  const shownUpdates = (updates ?? []).filter((u) => u.trim());
  return (
    <div className="flex gap-2.5">
      <Batzi mood={error || refused ? "worried" : working ? "thinking" : noAgent ? "sleepy" : "happy"} className={cn("mt-0.5 size-8 shrink-0", working && "animate-bounce [animation-duration:1.6s]")} />
      <div className="min-w-0 flex-1 space-y-2">
        {shownUpdates.length > 0 && (
          <ul className="text-muted-foreground space-y-0.5 text-xs italic">
            {shownUpdates.slice(-4).map((u, i) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden>·</span>
                <span className="line-clamp-2">{u}</span>
              </li>
            ))}
          </ul>
        )}
        {tools && tools.length > 0 && (
          <div className="space-y-1.5">
            {tools.map((o) => (
              <ToolChip key={o.id} outcome={o} live={live} />
            ))}
          </div>
        )}
        {text && (
          <div className="bg-card rounded-2xl rounded-tl-md border px-3.5 py-2.5 text-sm leading-relaxed shadow-xs">
            <Markdown text={text} />
          </div>
        )}
        {working && !shownUpdates.length && !tools?.length && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" /> {t("Batzi is on it…")}
          </div>
        )}
        {refused && !text && <p className="text-muted-foreground text-sm">{t("I can’t help with that one. Try rephrasing, or do it by hand — I won’t be offended.")}</p>}
        {noAgent && (
          <div className="bg-muted/60 rounded-2xl px-3.5 py-2.5 text-sm">
            <p className="font-medium">{t("Batzi is napping.")}</p>
            <p className="text-muted-foreground mt-1">{t("Free-form requests need an Anthropic API key on the server (ANTHROPIC_API_KEY). Quick sentences like “invoice Muster AG 3h consulting at 180” or “paid 12.50 for coffee” work right away.")}</p>
          </div>
        )}
        {error && <p className="text-destructive text-sm">{t(error)}</p>}
      </div>
    </div>
  );
}

function UserBubble({ text, files, via }: { text: string; files?: { id: number; name: string; mime: string | null }[]; via?: string }) {
  const t = useT();
  return (
    <div className="flex justify-end">
      <div className="bg-metal max-w-[85%] space-y-1.5 rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm text-white shadow-sm">
        {via === "email" && <p className="text-[10px] tracking-wide uppercase opacity-70">{t("By email")}</p>}
        {text ? <p className="whitespace-pre-wrap">{text}</p> : files?.length ? <p className="opacity-80">{t("Here, take care of this:")}</p> : null}
        {files && files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-foreground">
            {files.map((f) => (
              <FileChip key={f.id} file={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Conversation({ turns, live, className, empty }: { turns: UiTurn[]; live: LiveTurn | null; className?: string; empty?: React.ReactNode }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, live?.text, live?.tools.length, live?.updates.length]);

  if (!turns.length && !live) return <>{empty}</>;
  const lastUser = [...turns].reverse().find((t) => t.role === "user");
  const showPrompt = live && (live.prompt || live.files?.length) && !(lastUser && lastUser.text === live.prompt && !live.files?.length);
  return (
    <div className={cn("space-y-4", className)}>
      {turns.map((turn) =>
        turn.role === "user" ? (
          <UserBubble key={turn.id} text={turn.text} files={turn.files} via={turn.via} />
        ) : (
          <AssistantBubble key={turn.id} text={turn.text} updates={turn.updates} tools={turn.tools} refused={turn.refused} />
        ),
      )}
      {live && (
        <>
          {showPrompt && <UserBubble text={live.prompt ?? ""} files={live.files} />}
          <AssistantBubble live text={live.text} updates={live.updates} tools={live.tools} error={live.error} noAgent={live.noAgent} />
        </>
      )}
      <div ref={end} />
    </div>
  );
}
