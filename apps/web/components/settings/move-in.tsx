"use client";

import { Check, ChevronRight, Loader2, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { importStepAction } from "@/app/(app)/[tenant]/settings/actions";
import { confetti } from "@/components/fun/confetti";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@batzio/i18n/react";
import { IMPORT_PHASES, PHASE_LABELS, type ImportProgress } from "@batzio/server/importer-phases";

/**
 * Moving in from other accounting software: paste an access token, click
 * once, watch everything arrive. The import runs in short steps; the token
 * lives only in this page and is never stored.
 */
export function MoveIn({ tenant, defaultUrl, last }: { tenant: string; defaultUrl: string; last: ImportProgress | null }) {
  const t = useT();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [url, setUrl] = useState(defaultUrl);
  const [progress, setProgress] = useState<ImportProgress | null>(last);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  const run = async () => {
    setRunning(true);
    stop.current = false;
    let restart = !progress || progress.phase === "done";
    try {
      for (;;) {
        const r = await importStepAction(tenant, { token, baseUrl: url, restart });
        restart = false;
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setProgress(r.progress);
        if (r.progress.phase === "done") {
          confetti({ count: 90 });
          toast.success(t("Welcome home! Everything has moved in."));
          router.refresh();
          return;
        }
        if (stop.current) return;
      }
    } finally {
      setRunning(false);
    }
  };

  const current = progress?.phase ?? null;
  const index = current === "done" ? IMPORT_PHASES.length : current ? IMPORT_PHASES.indexOf(current) : -1;
  const total = (k: "imported" | "skipped" | "failed") => Object.values(progress?.counts ?? {}).reduce((s, c) => s + (c?.[k] ?? 0), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="shadow-xs">
        <CardHeader>
          <span className="bg-metal flex size-10 items-center justify-center rounded-xl text-white">
            <Truck className="size-5" />
          </span>
          <CardTitle className="font-display pt-2 text-xl">{t("Bring everything over in one click")}</CardTitle>
          <CardDescription>
            {t("Contacts, products, projects and time, quotes, orders and invoices with their payments, supplier bills, expenses and manual bookings. Numbers and states stay as they were; running it again only adds what is new.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <Field>
              <FieldLabel htmlFor="move-in-token">{t("Access token from your current software")}</FieldLabel>
              <Input id="move-in-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} required />
              <FieldDescription>{t("Create a personal access token in your current software’s API settings. Batzio uses it only for this import and never stores it.")}</FieldDescription>
            </Field>
            <details className="text-sm" open={!defaultUrl}>
              <summary className="text-muted-foreground cursor-pointer select-none">{t("Advanced")}</summary>
              <Field className="pt-3">
                <FieldLabel htmlFor="move-in-url">{t("API address")}</FieldLabel>
                <Input id="move-in-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required />
              </Field>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={running || !token || !url}>
                {running ? <Loader2 className="animate-spin" /> : <Truck />}
                {progress && progress.phase !== "done" ? t("Continue import") : t("Import everything")}
              </Button>
              {running && (
                <Button type="button" size="lg" variant="outline" onClick={() => (stop.current = true)}>
                  {t("Pause")}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle>{current === "done" ? t("Moved in") : progress ? t("Moving in…") : t("What moves in")}</CardTitle>
          {progress && (
            <CardDescription>
              {t("{n} imported · {s} already here · {f} failed", { n: total("imported"), s: total("skipped"), f: total("failed") })}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <ol className="space-y-1.5">
            {IMPORT_PHASES.map((phase, i) => {
              const c = progress?.counts[phase];
              const done = i < index;
              const active = i === index && running;
              return (
                <li key={phase} className={cn("flex items-center gap-2.5 text-sm", !done && !active && "text-muted-foreground")}>
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", done && "bg-success border-success text-white")}>
                    {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : <ChevronRight className="size-3 opacity-40" />}
                  </span>
                  <span className="flex-1">{t(PHASE_LABELS[phase])}</span>
                  {c && (c.imported || c.skipped || c.failed) ? (
                    <span className="num text-muted-foreground text-xs">
                      {c.imported}
                      {c.skipped ? ` · ${c.skipped}↺` : ""}
                      {c.failed ? <span className="text-danger"> · {c.failed}!</span> : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {progress?.warnings.length ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer select-none">{t("{n} notes from the import", { n: progress.warnings.length })}</summary>
              <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
                {progress.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {current === "done" && (
            <Button asChild variant="outline" className="mt-4">
              <Link href={`/${tenant}`}>
                {t("Open Today")} <ChevronRight />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
