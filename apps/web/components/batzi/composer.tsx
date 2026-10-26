"use client";

import { ArrowUp, Loader2, Paperclip, Wand2, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { planQuickAction, runQuickAction } from "@/app/(app)/[tenant]/agent-actions";
import { confetti } from "@/components/fun/confetti";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { QuickPlan } from "@batzio/server/agent/quick";
import { formatAmount } from "@batzio/core/format";
import { useMsg, useT } from "@batzio/i18n/react";
import { cn } from "@/lib/utils";
import { useBatzi } from "./batzi-provider";

type Attached = { id: number; name: string; mime: string | null };

export { QUICK_EXAMPLES as EXAMPLES } from "@batzio/server/agent/quick";
import { QUICK_EXAMPLES as EXAMPLES } from "@batzio/server/agent/quick";

/** One sentence, any language: a live preview for quick ones, Batzi for everything else. */
export function Composer({ autoFocus, className, compact }: { autoFocus?: boolean; className?: string; compact?: boolean }) {
  const t = useT();
  const m = useMsg();
  const { tenant, agent, ask, busy, upload } = useBatzi();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<QuickPlan | null>(null);
  const [files, setFiles] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState(false);
  const [running, startRun] = useTransition();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (files.length || text.trim().length < 3) {
      setPlan(null);
      return;
    }
    const handle = setTimeout(() => {
      planQuickAction(tenant, text)
        .then(setPlan)
        .catch(() => setPlan(null));
    }, 220);
    return () => clearTimeout(handle);
  }, [text, files.length, tenant]);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      const el = input.current;
      // Only the visible composer takes it.
      if (!el || !el.offsetParent) return;
      setText((e as CustomEvent<string>).detail);
      el.focus();
    };
    window.addEventListener("batzio:prefill", onPrefill);
    return () => window.removeEventListener("batzio:prefill", onPrefill);
  }, []);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const attach = async (list: File[]) => {
    if (!list.length) return;
    setUploading(true);
    try {
      const stored = await upload(list);
      setFiles((f) => [...f, ...stored]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  const runPlan = (actionId: string) =>
    startRun(async () => {
      const res = await runQuickAction(tenant, text, actionId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const o = res.outcome;
      toast.success(m(o.message), {
        action: o.record ? { label: t("Open"), onClick: () => (window.location.href = `/${tenant}/${o.record!.resource}/${o.record!.id}`) } : undefined,
      });
      if (o.celebrate) confetti();
      setText("");
      setPlan(null);
    });

  const send = async () => {
    const value = text.trim();
    if (busy || (!value && !files.length)) return;
    if (!agent) {
      const primary = plan?.actions.find((a) => a.primary);
      if (primary && !plan?.warnings.length) return runPlan(primary.id);
      toast.info(t("Batzi is napping (no API key). Try a quick sentence like “paid 12.50 for coffee”."));
      return;
    }
    const sent = files;
    setText("");
    setFiles([]);
    setPlan(null);
    await ask(value, { fileIds: sent.map((f) => f.id), files: sent });
  };

  return (
    <div className={cn("space-y-2", className)}>
      {plan && (
        <div className="bg-card animate-in fade-in slide-in-from-bottom-1 rounded-2xl border p-3 shadow-sm">
          <div className="flex items-start gap-2">
            <Zap className="text-primary mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold">{m(plan.headline)}</p>
              {plan.details.map((d, i) => (
                <p key={i} className="text-muted-foreground truncate text-xs">
                  {m(d)}
                </p>
              ))}
              {plan.warnings.map((w, i) => (
                <p key={i} className="text-warning-foreground mt-1 text-xs text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning">
                  {m(w)}
                </p>
              ))}
            </div>
            {plan.total !== undefined && <span className="font-display num shrink-0 text-sm font-semibold">CHF {formatAmount(plan.total)}</span>}
          </div>
          {plan.actions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {plan.actions.map((a) => (
                <Button key={a.id} size="sm" variant={a.primary ? "default" : "outline"} disabled={running} onClick={() => runPlan(a.id)}>
                  {running && a.primary ? <Loader2 className="animate-spin" /> : a.primary ? <Zap /> : null}
                  {m(a.label)}
                </Button>
              ))}
              <span className="text-muted-foreground text-[11px]">{agent ? t("or press Enter to let Batzi handle it") : t("instant, no AI needed")}</span>
            </div>
          )}
        </div>
      )}
      <div
        data-batzi-composer
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void attach(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "bg-card focus-within:ring-primary/30 relative rounded-2xl border shadow-sm transition focus-within:ring-2",
          over && "ring-primary ring-2",
        )}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {files.map((f) => (
              <span key={f.id} className="bg-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">
                {f.name}
                <button type="button" aria-label={t("Remove")} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          autoFocus={autoFocus}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              void attach(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={agent ? t("Tell Batzi anything — or drop a file…") : t("Type a quick sentence: “invoice Muster AG 3h consulting at 180”")}
          className={cn("placeholder:text-muted-foreground/70 block w-full resize-none bg-transparent px-4 text-[15px] outline-none", compact ? "py-3" : "py-3.5")}
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <input ref={picker} type="file" multiple hidden onChange={(e) => void attach(Array.from(e.target.files ?? []))} />
          <Button type="button" size="icon" variant="ghost" className="size-8 rounded-full" aria-label={t("Attach files")} disabled={!agent || uploading} onClick={() => picker.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
          </Button>
          {!compact && (
            <span className="text-muted-foreground hidden items-center gap-1 text-[11px] sm:inline-flex">
              <Wand2 className="size-3" /> {t("Drop or paste files anywhere")}
            </span>
          )}
          <span className="ml-auto hidden text-[11px] sm:inline">
            <Kbd>⌘J</Kbd>
          </span>
          <Button type="button" size="icon" className="bg-metal size-8 rounded-full text-white" aria-label={t("Send")} disabled={busy || (!text.trim() && !files.length)} onClick={() => void send()}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Puts text into the nearest composer (Today console or the Batzi panel). */
export function prefill(text: string) {
  window.dispatchEvent(new CustomEvent("batzio:prefill", { detail: text }));
}

export function ExampleChips() {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {EXAMPLES.map((e) => (
        <button key={e} type="button" onClick={() => prefill(t(e))} className="bg-background/70 hover:bg-secondary hover:border-primary/30 rounded-full border px-3 py-1 text-xs transition-colors">
          {t(e)}
        </button>
      ))}
    </div>
  );
}
