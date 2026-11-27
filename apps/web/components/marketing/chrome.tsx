import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ExperimentBanner } from "@/components/shell/experiment-banner";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { currentUser } from "@/lib/server/session";

/** Header of the public pages; `home` is "" on the landing page and "/" elsewhere, so the section links still land. */
export async function MarketingHeader({ home = "" }: { home?: string }) {
  const [user, t] = await Promise.all([currentUser(), getT()]);
  const nav: [string, string][] = [
    ["#fast", t("Speed")],
    ["#apps", t("Apps")],
    ["#agents", t("AI agents")],
    ["#api", t("API")],
    ["#move-in", t("Move in")],
    ["/pricing", t("Pricing")],
  ];
  return (
    <>
      <ExperimentBanner />
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Brand />
          <nav className="hidden items-center gap-1 lg:flex" aria-label={t("Sections")}>
            {nav.map(([href, label]) => (
              <Button key={href} variant="ghost" size="sm" render={<a href={href.startsWith("/") ? href : `${home}${href}`} />}>
                {label}
              </Button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LocaleSwitcher compact className="hidden sm:inline-flex" />
            {user ? (
              <Button render={<Link href="/select" />}>
                {t("Open Batzio")} <ArrowRight />
              </Button>
            ) : (
              <>
                <Button variant="ghost" render={<Link href="/login" />}>
                  {t("Sign in")}
                </Button>
                <Button render={<Link href="/signup" />}>{t("Start free")}</Button>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

export async function MarketingFooter() {
  const t = await getT();
  return (
    <footer className="border-t">
      <div className="text-muted-foreground mx-auto max-w-6xl space-y-4 px-4 py-8 text-sm sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Brand />
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label={t("More")}>
            <Link href="/pricing" className="hover:text-foreground">
              {t("Pricing")}
            </Link>
            <Link href="/vs/bexio" className="hover:text-foreground">
              Batzio vs bexio
            </Link>
            <Link href="/docs/api" className="hover:text-foreground">
              {t("API")}
            </Link>
          </nav>
          <LocaleSwitcher compact className="sm:hidden" />
        </div>
        <p>
          © {new Date().getFullYear()} Batzio · {t("Made in Switzerland, for people who would rather spend their time on something other than accounting.")}
        </p>
      </div>
    </footer>
  );
}

/** Centred section title with a sticker kicker, as on the landing page. */
export function SectionHeading({ kicker, icon: Icon, title, text, id }: { kicker: string; icon: LucideIcon; title: string; text: string; id: string }) {
  return (
    <div className="mx-auto mb-10 max-w-3xl text-center">
      <span className="sticker">
        <Icon className="text-primary size-3.5" /> {kicker}
      </span>
      <h2 id={id} className="font-display mt-4 text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      <p className="text-muted-foreground mt-4 text-lg leading-8 text-balance">{text}</p>
    </div>
  );
}
