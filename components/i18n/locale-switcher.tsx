"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LanguagesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { setLocaleAction } from "@/app/i18n-actions";

/** Four little pills: EN · DE · FR · IT. */
export function LocaleSwitcher({ className, compact }: { className?: string; compact?: boolean }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (l: Locale) =>
    start(async () => {
      await setLocaleAction(l);
      router.refresh();
    });
  return (
    <div role="radiogroup" aria-label={t("Language")} className={cn("inline-flex items-center gap-0.5 rounded-full border bg-background/60 p-0.5 backdrop-blur", pending && "opacity-60", className)}>
      {!compact && <LanguagesIcon className="text-muted-foreground mx-1.5 size-3.5" aria-hidden />}
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={l === locale}
          title={LOCALE_NAMES[l]}
          onClick={() => l !== locale && choose(l)}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase transition-colors",
            l === locale ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
