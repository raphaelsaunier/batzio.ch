import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";

/** Shown on every page: Batzio is an experiment, not a product to trust with real books. */
export async function ExperimentBanner({ className }: { className?: string }) {
  const t = await getT();
  return (
    <div role="note" className={cn("border-warning/30 bg-warning/15 text-[color-mix(in_oklch,var(--warning),black_45%)] dark:text-warning border-b px-4 py-1.5 text-center text-xs leading-5", className)}>
      <FlaskConical className="mr-1.5 inline size-3.5 -translate-y-px" aria-hidden />
      <strong className="font-semibold">{t("Batzio is a vibe-coding experiment.")}</strong> {t("Don’t use it for real data — and please don’t sue us.")}
    </div>
  );
}
