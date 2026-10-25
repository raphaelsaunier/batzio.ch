import { ArrowRight, AtSign, BookOpen, Bot, Building2, FileCode2, FolderKanban, IdCard, Inbox, Landmark, Languages, MessageSquareText, QrCode, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { CoinHero } from "@/components/brand/coin-hero";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { currentUser } from "@/lib/server/session";
import { N_ } from "@/lib/i18n";

const FEATURES = [
  { icon: Inbox, title: N_("Drop anything"), text: N_("Bills, receipts, bank statements, spreadsheets, screenshots, your logo. Batzi reads it, books it and files the original.") },
  { icon: AtSign, title: N_("Or just email it"), text: N_("Every company gets a private address. Suppliers can send bills straight in; you can forward receipts from your phone.") },
  { icon: MessageSquareText, title: N_("Say it like a human"), text: N_("“Invoice Muster AG 3h consulting at 180.” “Anna paid.” “Number invoices RE-2026-001.” Any of four languages.") },
  { icon: QrCode, title: N_("Swiss QR-bills"), text: N_("Quotes, orders, invoices and credit notes with QR-IBAN and references, in the customer’s language. Late payers get nudged politely.") },
  { icon: BookOpen, title: N_("Real double-entry books"), text: N_("Swiss SME chart of accounts, exact VAT, journal, ledgers, balance sheet and year-end closing — behind the accountant goggles.") },
  { icon: Landmark, title: N_("Bank on autopilot"), text: N_("camt.053/054 in, payments matched by QR reference, pain.001 out. You confirm with one click, or not at all.") },
  { icon: IdCard, title: N_("Payroll, alphabet soup included"), text: N_("AHV/IV/EO, ALV, BVG, NBU, KTG and withholding tax worked out and booked. Payslips in PDF.") },
  { icon: FolderKanban, title: N_("Projects & time"), text: N_("Budgets, tasks and time tracking. Unbilled hours become invoices before you forget them.") },
  { icon: Bot, title: N_("Bring your own agents"), text: N_("A full REST API with OpenAPI docs and an MCP server, so Claude and friends can work in your books too.") },
  { icon: ShieldCheck, title: N_("Tamper-proof audit log"), text: N_("Every change — by you, Batzi, email or API — is hash-chained and verifiable. Your fiduciary will purr.") },
  { icon: Building2, title: N_("One vault per company"), text: N_("Each company lives in its own database. Fiduciaries switch between clients from one login.") },
  { icon: Languages, title: N_("Four languages, zero jargon"), text: N_("English, Deutsch, Français, Italiano. Every accounting term comes with a plain-words explanation.") },
];

export default async function LandingPage() {
  const [user, t] = await Promise.all([currentUser(), getT()]);
  return (
    <div className="bg-background min-h-svh">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Brand />
          <nav className="flex items-center gap-2">
            <LocaleSwitcher compact className="hidden sm:inline-flex" />
            <Button variant="ghost" asChild className="hidden md:inline-flex">
              <Link href="/docs/api">API</Link>
            </Button>
            {user ? (
              <Button asChild>
                <Link href="/select">
                  {t("Open Batzio")} <ArrowRight />
                </Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/login">{t("Sign in")}</Link>
                </Button>
                <Button asChild>
                  <Link href="/signup">{t("Start free")}</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[44rem] bg-[radial-gradient(ellipse_at_top,oklch(0.66_0.09_238/0.2),transparent_62%)]" />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pt-14 pb-16 text-center sm:px-6 sm:pt-20">
          <CoinHero suite="Accounting Suite" sweet={t("Accounting, Sweet!")} hint={t("Psst — click the coin.")} />
          <h1 className="font-display mt-12 max-w-3xl text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-6xl">
            {t("You run the business.")}{" "}
            <span className="doodle-underline">
              <span className="text-metal">{t("Batzi does the books.")}</span>
            </span>
          </h1>
          <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-8 text-balance">
            {t("Swiss bookkeeping for people with a deep aversion to accounting. Drop a bill, forward a receipt or type “invoice Muster AG 3h consulting” — Batzio books it, adds the QR code, matches the bank and fills in your VAT return.")}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link href={user ? "/select" : "/signup"}>
                {user ? t("Open your companies") : t("Start free — demo data included")} <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="#features">{t("What can it do?")}</Link>
            </Button>
          </div>
          <div className="bg-border mt-14 grid w-full gap-px overflow-hidden rounded-2xl border sm:grid-cols-3">
            {[
              ["0", t("accounting terms you need to know")],
              ["4", t("languages: EN · DE · FR · IT")],
              ["1", t("click to book what the bank sends")],
            ].map(([k, v]) => (
              <div key={v} className="bg-card p-6">
                <div className="font-display num text-3xl font-bold tracking-tight">{k}</div>
                <div className="text-muted-foreground mt-1 text-sm">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
        <h2 className="font-display mb-8 text-center text-3xl font-bold tracking-tight">{t("Everything a Swiss business needs. None of the homework.")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-card lift rounded-2xl border p-6 shadow-xs">
              <span className="bg-metal flex size-10 items-center justify-center rounded-xl text-white">
                <f.icon className="size-5" />
              </span>
              <h3 className="font-display mt-4 text-lg font-semibold">{t(f.title)}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">{t(f.text)}</p>
            </div>
          ))}
        </div>
        <div className="bg-metal mt-12 flex flex-col items-start justify-between gap-6 rounded-3xl p-8 text-white sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">{t("Your data, your exit door")}</h2>
            <p className="mt-2 max-w-xl text-white/80">{t("PDFs, XLSX exports of every list and report, and a complete API. Leave whenever you like — we’ll be sad, but we’ll hold the door.")}</p>
          </div>
          <Button size="lg" variant="secondary" asChild>
            <Link href="/docs/api">
              <FileCode2 /> {t("Explore the API")}
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Brand />
          <LocaleSwitcher compact className="sm:hidden" />
          <span>
            © {new Date().getFullYear()} Batzio · {t("Made in Switzerland, with a deep aversion to accounting.")}
          </span>
        </div>
      </footer>
    </div>
  );
}
