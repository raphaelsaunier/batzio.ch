import Link from "next/link";
import { Brand } from "@/components/brand";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { getT } from "@/lib/i18n/server";
import { N_ } from "@/lib/i18n";

const POINTS = [
  N_("Drop a bill, a receipt or a bank statement — Batzi books it"),
  N_("Swiss QR-bills, friendly reminders, VAT return filled in"),
  N_("Real double-entry books for your fiduciary, no jargon for you"),
  N_("Projects, time tracking and Swiss payroll"),
  N_("English, Deutsch, Français, Italiano"),
];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="bg-metal relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,oklch(1_0_0/0.25),transparent_55%)]" />
        <picture className="pointer-events-none absolute -right-28 -bottom-28 block size-[30rem] rotate-[-12deg] opacity-25 drop-shadow-2xl">
          <source type="image/avif" srcSet="/brand/coin-back-720.avif" />
          <source type="image/webp" srcSet="/brand/coin-back-720.webp" />
          <img src="/brand/coin-back-720.png" alt="" className="size-full" />
        </picture>
        <Link href="/" className="relative">
          <Brand tone="inverted" />
        </Link>
        <div className="relative mt-auto max-w-md space-y-6">
          <h2 className="font-display text-3xl leading-tight font-bold tracking-tight">{t("Accounting, Sweet!")}</h2>
          <ul className="space-y-3 text-sm text-white/85">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/80" />
                {t(p)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/60">{t("Every company runs on its own isolated database.")}</p>
        </div>
      </aside>
      <main className="relative flex items-center justify-center px-4 py-10 sm:px-10">
        <LocaleSwitcher compact className="absolute top-4 right-4" />
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
