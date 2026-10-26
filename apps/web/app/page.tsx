import { ArrowRight, AtSign, BookOpen, Bot, Building2, FileCode2, FolderKanban, IdCard, Inbox, Keyboard, Landmark, Languages, MessageSquareText, Plug, QrCode, Search, ShieldCheck, Smartphone, Truck, Wallet, WifiOff, Zap } from "lucide-react";
import Link from "next/link";
import { CoinHero } from "@/components/brand/coin-hero";
import { MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/chrome";
import { NativeApps } from "@/components/marketing/devices";
import { Pricing } from "@/components/marketing/pricing";
import { AgentChats, CompatCoverage, CompatDiff, McpConfig, MoveInSteps } from "@/components/marketing/sections";
import { SpeedDemo } from "@/components/marketing/speed-demo";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { currentUser } from "@/lib/server/session";
import { N_ } from "@batzio/i18n";

const FEATURES = [
  { icon: Inbox, title: N_("Drop anything"), text: N_("Bills, receipts, bank statements, spreadsheets, screenshots, your logo. Batzi reads it, books it and files the original.") },
  { icon: AtSign, title: N_("Or just email it"), text: N_("Every company gets a private address. Suppliers can send bills straight in; you can forward receipts from your phone.") },
  { icon: MessageSquareText, title: N_("Say it like a human"), text: N_("“Invoice Muster AG 3h consulting at 180.” “Anna paid.” “Number invoices RE-2026-001.” Any of four languages.") },
  { icon: QrCode, title: N_("Swiss QR-bills"), text: N_("Quotes, orders, invoices and credit notes with the Swiss QR-bill, in the customer’s language. Late payers get nudged politely.") },
  { icon: BookOpen, title: N_("Real double-entry books"), text: N_("Swiss SME chart of accounts, exact VAT, journal, ledgers, balance sheet and year-end closing — behind the accountant goggles.") },
  { icon: Landmark, title: N_("Bank on autopilot"), text: N_("Import bank statements, let payments match themselves and pay bills in one go. You confirm with one click, or not at all.") },
  { icon: IdCard, title: N_("Payroll, alphabet soup included"), text: N_("AHV/IV/EO, ALV, BVG, NBU, KTG and withholding tax worked out and booked. Payslips in PDF.") },
  { icon: FolderKanban, title: N_("Projects & time"), text: N_("Budgets, tasks and time tracking. Unbilled hours become invoices before you forget them.") },
  { icon: ShieldCheck, title: N_("Tamper-proof history"), text: N_("Every change — by you, Batzi, email or an integration — is recorded and can’t be altered. Your fiduciary will purr.") },
  { icon: Building2, title: N_("One vault per company"), text: N_("Each company’s books are kept completely separate. Fiduciaries switch between clients from one login.") },
  { icon: Languages, title: N_("Four languages, zero jargon"), text: N_("English, Deutsch, Français, Italiano. Every accounting term comes with a plain-words explanation.") },
  { icon: Bot, title: N_("Bring your own assistant"), text: N_("Claude and other AI assistants can work in your books too — with exactly the access you choose.") },
];

export default async function LandingPage() {
  const [user, t] = await Promise.all([currentUser(), getT()]);
  return (
    <div className="bg-background min-h-svh overflow-x-clip">
      <MarketingHeader />

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[44rem] bg-[radial-gradient(ellipse_at_top,oklch(0.66_0.09_238/0.2),transparent_62%)]" />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pt-14 pb-16 text-center sm:px-6 sm:pt-20">
          <CoinHero suite="Accounting Suite" sweet="Accounting, Sweet!" />
          <p className="text-muted-foreground mt-10 max-w-2xl text-lg leading-8 text-balance">
            {t("Swiss bookkeeping that feels instant, works on every device and with your AI assistant, fits the tools you already use — and moves in from your old software in one click.")}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link href={user ? "/select" : "/signup"}>
                {user ? t("Open your companies") : t("Start free — demo data included")} <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#move-in">
                <Truck /> {t("Switch in one click")}
              </a>
            </Button>
          </div>
          <div className="bg-border mt-14 grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl border sm:grid-cols-4">
            {[
              [t("Instant"), t("from one page to the next")],
              ["5", t("native apps, plus the web")],
              ["100%", t("compatible with your integrations")],
              ["1", t("click to move in")],
            ].map(([k, v]) => (
              <div key={v} className="bg-card p-5 sm:p-6">
                <div className="font-display num text-3xl font-bold tracking-tight">{k}</div>
                <div className="text-muted-foreground mt-1 text-sm">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="fast" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionHeading
          id="fast"
          icon={Zap}
          kicker={t("Blazing fast")}
          title={t("Faster than you can blink. Literally.")}
          text={t("Every page opens the moment you click, and search answers while you type — even on a shaky train connection.")}
        />
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <ul className="space-y-6">
            {[
              { icon: Zap, title: t("No waiting, ever"), text: t("Pages open instantly. No spinners, no loading bars.") },
              { icon: Search, title: t("Search as you type"), text: t("Find any invoice, contact or receipt in a keystroke.") },
              { icon: WifiOff, title: t("Keeps working offline"), text: t("On the train or in the cellar: everything you have opened stays readable without a connection.") },
              { icon: Keyboard, title: t("Made for the keyboard"), text: t("Shortcuts for everything. Press ? to see them all.") },
            ].map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="bg-metal flex size-10 shrink-0 items-center justify-center rounded-xl text-white">
                  <f.icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold">{f.title}</h3>
                  <p className="text-muted-foreground text-sm leading-6">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <div>
            <SpeedDemo />
            <p className="text-muted-foreground mt-3 text-center text-xs">{t("Try it: type to search, or use the arrow keys.")}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="apps" className="bg-hero scroll-mt-20 border-y py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            id="apps"
            icon={Smartphone}
            kicker={t("Native apps")}
            title={t("At home on every screen you own.")}
            text={t("Real apps for iPhone, iPad, Mac, Vision Pro, Android and Windows. The same data and the same four languages, everywhere.")}
          />
          <NativeApps />
        </div>
      </section>

      <section aria-labelledby="agents" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionHeading
          id="agents"
          icon={Bot}
          kicker={t("AI assistants & MCP")}
          title={t("Your AI can do the bookkeeping, too.")}
          text={t("Batzi is built in, and Claude, ChatGPT or your own assistant can connect too. Every step they take is recorded.")}
        />
        <AgentChats />
        <div className="mt-8 grid items-center gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-sm leading-6">
            <h3 className="font-display text-xl font-semibold">{t("Safe by design")}</h3>
            <p className="text-muted-foreground">
              {t("Assistants only get the access you give them, ask before anything that can’t be undone, and every change they make is recorded.")}
            </p>
            <p className="text-muted-foreground text-xs">{t("Sample conversations, written with the demo company’s data.")}</p>
          </div>
          <McpConfig />
        </div>
      </section>

      <section aria-labelledby="api" className="bg-muted/40 scroll-mt-20 border-y py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            id="api"
            icon={Plug}
            kicker={t("100% API compatible")}
            title={t("Your integrations keep working.")}
            text={t("Integrations built for your current accounting software work with Batzio as they are: change the address and the access key, keep everything else.")}
          />
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <CompatDiff />
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["310/310", t("endpoints covered")],
                  ["0", t("lines to rewrite")],
                  ["1", t("minute to switch")],
                ].map(([k, v]) => (
                  <div key={v} className="neu-card p-4 text-center">
                    <div className="font-display num text-xl font-bold tracking-tight">{k}</div>
                    <div className="text-muted-foreground mt-1 text-xs">{v}</div>
                  </div>
                ))}
              </div>
              <CompatCoverage />
              <p className="text-muted-foreground text-sm leading-6">
                {t("Every endpoint is covered and tested, so your integrations behave exactly as before.")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="move-in" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionHeading
          id="move-in"
          icon={Truck}
          kicker={t("1-click importer")}
          title={t("Moving in takes one click.")}
          text={t("Switch from your current accounting software without exports, spreadsheets or a lost weekend: Batzio brings everything over and puts it where it belongs.")}
        />
        <MoveInSteps />
        <div className="mt-10 flex justify-center">
          <Button size="lg" asChild>
            <Link href={user ? "/select" : "/signup"}>
              <Truck /> {user ? t("Open your companies") : t("Start free and move in")}
            </Link>
          </Button>
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
            <p className="mt-2 max-w-xl text-white/80">{t("PDFs, Excel exports of every list and report, and a complete API. Leave whenever you like — we’ll be sad, but we’ll hold the door.")}</p>
          </div>
          <Button size="lg" variant="secondary" asChild>
            <Link href="/docs/api">
              <FileCode2 /> {t("Explore the API")}
            </Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="pricing" className="bg-hero scroll-mt-20 border-y py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            id="pricing"
            icon={Wallet}
            kicker={t("Pricing")}
            title={t("Fair prices. Free where it matters.")}
            text={t("Every plan has every feature — payroll, projects, stock, the AI assistant, the API. You only pay for the people who use it.")}
          />
          <Pricing />
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
