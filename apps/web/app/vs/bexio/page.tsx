import { ArrowRight, Bot, Calculator, Code, Copy, FileText, History, Landmark, LifeBuoy, Plug, Scale, Sparkles, Truck, Users, Wallet, WifiOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/chrome";
import { ComparisonTable, type Group } from "@/components/marketing/comparison";
import { Figures } from "@/components/marketing/figures";
import { MoveInSteps } from "@/components/marketing/sections";
import { YearCosts } from "@/components/marketing/year-costs";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { shareMetadata } from "@/lib/share";

/**
 * Batzio next to bexio, row by row. Everything said about bexio comes from
 * bexio's own published pages (see SOURCES, checked on CHECKED): prices are
 * per month excl. VAT on the annual plan unless stated. Where Batzio is not
 * there yet the row says so (“Coming soon”, or “One day” for the far future).
 */

const CHECKED = "26.10.2026";
const SOURCES = [
  ["bexio.com/en-CH/packages-and-prices", "https://www.bexio.com/en-CH/packages-and-prices"],
  ["bexio package comparison (28.05.2026)", "https://cdn.www.bexio.com/assets/content_craft/documents/bexio/compare-packages-en.pdf"],
  ["bexio.com/de-CH/vereinssoftware", "https://www.bexio.com/de-CH/vereinssoftware"],
] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: { absolute: "Batzio vs bexio" }, ...(await shareMetadata("vs")) };
}

export default async function VsBexioPage() {
  const t = await getT();
  const chf = (amount: string) => `CHF ${amount}`;
  const plan = (annual: string, monthly: string) => t("CHF {annual} (annual plan) or {monthly} (monthly)", { annual, monthly });
  const from = (pkg: string) => t("From {package}", { package: pkg });

  const groups: Group[] = [
    {
      title: t("Apps & AI"),
      icon: Bot,
      rows: [
        { label: t("Web app"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("Native apps"), them: { mark: "yes", text: t("bexio Go for phones") }, us: { mark: "yes", text: "iPhone, iPad, Mac, Android, Windows" }, win: true },
        { label: t("Works offline"), them: { mark: "no", text: t("Cloud-based") }, us: { mark: "yes", text: t("Desktop and mobile apps, free forever") }, win: true },
        {
          label: t("AI reads receipts and QR-bills"),
          them: { text: t("From Advanced: 50, 100 or unlimited scans a month, by package") },
          us: { mark: "yes", text: t("Every plan: drop, email or photograph anything") },
          win: true,
        },
        { label: t("An assistant that does the booking"), them: { mark: "no" }, us: { mark: "yes", text: t("Batzi, on every screen, in four languages") }, win: true },
        { label: t("Claude, ChatGPT and other AI agents (MCP)"), them: { mark: "no" }, us: { mark: "yes", text: t("Built in, with the access you choose") }, win: true },
      ],
    },
    {
      title: t("Sales"),
      icon: FileText,
      rows: [
        { label: t("Quotes, orders, delivery notes, invoices, credit notes"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("Swiss QR-bill"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("Your own design, in several languages"), them: { mark: "yes", text: t("Templates") }, us: { mark: "yes", text: t("Edited right on the page") }, win: true },
        { label: t("Recurring invoices"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("Reminders with fees"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("Send by email or as an online link"), them: { mark: "yes" }, us: { mark: "soon" } },
      ],
    },
    {
      title: t("Purchases & bank"),
      icon: Landmark,
      rows: [
        { label: t("Supplier bills"), them: { text: from("Advanced") }, us: { mark: "yes", text: t("Every plan") }, win: true },
        { label: t("Purchase orders"), them: { text: from("Optima") }, us: { mark: "yes", text: t("Every plan") }, win: true },
        { label: t("Supplier credit notes"), them: { text: from("Advanced") }, us: { mark: "soon" } },
        { label: t("Bank statements in, payments matched"), them: { mark: "yes", text: t("Depth varies by package") }, us: { mark: "yes", text: t("camt.053/054 and CSV, every plan") } },
        { label: t("Pay bills with an ISO 20022 file"), them: { mark: "yes", text: t("Depth varies by package") }, us: { mark: "yes", text: t("Every plan") } },
        { label: t("Direct connection to 40+ banks"), them: { mark: "yes" }, us: { mark: "soon" } },
        { label: t("Payment cards, Apple Pay and Google Pay"), them: { text: t("bexio Pay: CHF 14.– a month extra, included in Ultimate") }, us: { mark: "oneday" } },
        { label: t("Company credit"), them: { text: t("bexio Credit, optional") }, us: { mark: "oneday" } },
      ],
    },
    {
      title: t("Accounting & VAT"),
      icon: Calculator,
      rows: [
        { label: t("Double-entry books with the Swiss SME chart of accounts"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("Balance sheet and income statement"), them: { mark: "yes" }, us: { mark: "yes", text: t("Plus year-end closing") } },
        { label: t("VAT: effective or net tax rate method, ESTV form"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("VAT on agreed or received payments"), them: { mark: "yes" }, us: { mark: "soon", badge: t("Received: coming soon"), text: t("Agreed works today") } },
        { label: t("Access for your fiduciary"), them: { mark: "yes", text: t("Free") }, us: { mark: "yes", text: t("One login for all their clients") } },
        { label: t("Receipts archived with the bookings"), them: { mark: "yes", text: t("GeBüV-compliant") }, us: { mark: "yes", text: t("Every plan, protected from deletion (Art. 958f CO)") } },
        { label: t("Tamper-evident history of every change, with undo"), them: { mark: "no" }, us: { mark: "yes", text: t("Who, when, from where, and with which app") }, win: true },
        { label: t("Duplicate detection"), them: { mark: "no" }, us: { mark: "yes", text: t("Files, references, contacts") }, win: true },
      ],
    },
    {
      title: t("Projects, stock & payroll"),
      icon: Users,
      rows: [
        { label: t("Tasks"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("Projects, time tracking, billing the hours"), them: { mark: "yes", text: t("Depth varies by package") }, us: { mark: "yes", text: t("Every plan") } },
        { label: t("Stock with minimum levels"), them: { mark: "yes", text: t("Depth varies by package") }, us: { mark: "yes", text: t("Every plan") } },
        {
          label: t("Payslips with AHV/IV/EO, ALV, BVG and withholding tax"),
          them: { text: t("From CHF 7.– a month extra, included in Ultimate") },
          us: { mark: "yes", text: t("Included") },
          win: true,
        },
        { label: t("Withholding tax tables for every canton"), them: { mark: "yes" }, us: { mark: "soon", text: t("A rate per employee works today") } },
        { label: t("Swissdec certification and ELM wage reporting"), them: { mark: "yes", text: t("With payroll") }, us: { mark: "soon" } },
      ],
    },
    {
      title: t("Open source & integrations"),
      icon: Plug,
      rows: [
        { label: t("Open source"), them: { mark: "no" }, us: { mark: "yes" }, win: true },
        { label: t("Run it on your own server"), them: { mark: "no", text: t("Cloud-based") }, us: { mark: "yes", text: t("Free") }, win: true },
        { label: t("Getting set up"), them: { text: t("Setup services from CHF 220.– each") }, us: { mark: "yes", text: t("Move in from bexio in one click, free") }, win: true },
        { label: t("REST API"), them: { mark: "yes" }, us: { mark: "yes", text: t("OpenAPI, plus your bexio integrations work unchanged") }, win: true },
        { label: t("App marketplace"), them: { mark: "yes", text: t("50+ to 100+ apps, by package") }, us: { mark: "soon" } },
      ],
    },
    {
      title: t("Help & hosting"),
      icon: LifeBuoy,
      rows: [
        { label: t("Support"), them: { mark: "yes", text: t("Phone, plus email and chat around the clock") }, us: { mark: "soon", badge: t("Phone: coming soon"), text: t("Batzi answers around the clock today") } },
        { label: t("Legal advice by phone"), them: { mark: "yes" }, us: { mark: "oneday" } },
        {
          label: t("Where your data lives"),
          them: { mark: "yes", text: t("Switzerland, ISO 27001") },
          us: { mark: "soon", badge: t("Swiss hosting: coming soon"), text: t("Your device, your own server, or our cloud") },
        },
      ],
    },
    {
      title: t("Price"),
      icon: Wallet,
      rows: [
        { label: t("1 user, per month"), them: { text: plan("35.–", "45.–") }, us: { text: chf("5.–") }, win: true },
        { label: t("5 users, per month"), them: { text: plan("69.–", "79.–") }, us: { text: chf("25.–") }, win: true },
        { label: t("25 users, per month"), them: { text: plan("119.–", "129.–") }, us: { text: chf("50.–") }, win: true },
        { label: t("50 users, per month"), them: { text: t("On request") }, us: { text: chf("50.–") }, win: true },
        { label: t("Every feature in every plan"), them: { mark: "no", text: t("Four packages, plus add-ons") }, us: { mark: "yes" }, win: true },
        {
          label: t("Associations & non-profits"),
          them: { text: t("50 % off in the first year for new customers, limited to 200 associations, until 31.12.2026") },
          us: { mark: "yes", text: t("Free") },
          win: true,
        },
      ],
    },
  ];

  const only = [
    { icon: Sparkles, title: t("An assistant that does the booking"), text: t("Drop a receipt, forward an email or type one sentence in any of four languages. Batzi books it, and asks before anything that can’t be undone.") },
    { icon: Plug, title: t("Your AI tools, connected"), text: t("Claude, ChatGPT and other assistants work in your books over MCP, with exactly the access you give them.") },
    { icon: WifiOff, title: t("Works offline"), text: t("Desktop and mobile apps that keep your books on your own device, free forever.") },
    { icon: History, title: t("Every change, with undo"), text: t("A tamper-evident history shows who changed what, when and from where — and lets you take it back.") },
    { icon: Copy, title: t("Duplicates caught"), text: t("The same receipt, reference or contact twice? Batzio notices and lets you merge or dismiss it.") },
    { icon: Code, title: t("Open source"), text: t("Read every line, or run Batzio on your own server at no cost.") },
  ];

  return (
    <div className="bg-background min-h-svh overflow-x-clip">
      <MarketingHeader home="/" />

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(ellipse_at_top,oklch(0.66_0.09_238/0.2),transparent_62%)]" />
        <div className="relative mx-auto max-w-4xl px-4 pt-14 pb-12 text-center sm:px-6 sm:pt-20">
          <span className="sticker">
            <Scale className="text-primary size-3.5" /> Batzio vs bexio
          </span>
          <h1 className="font-display mt-5 text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl">{t("Batzio vs bexio, feature by feature.")}</h1>
          <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg leading-8 text-balance">
            {t("An assistant that books for you, apps that work offline, a history you can undo and the source code to run it yourself — next to bexio’s package comparison, including what we don’t do yet.")}
          </p>
          <div className="bg-border mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border text-left lg:grid-cols-4">
            {[
              ["Batzi", t("does the booking from a sentence, a photo or an email")],
              [t("Offline"), t("desktop and mobile apps, free. bexio is cloud-based")],
              [t("Undo"), t("for every change, in a tamper-evident history")],
              ["AGPL", t("open source: read every line, run it yourself")],
            ].map(([k, v]) => (
              <div key={v} className="bg-card p-5">
                <div className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{k}</div>
                <div className="text-muted-foreground mt-1 text-sm">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="only" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
        <SectionHeading
          id="only"
          icon={Sparkles}
          kicker={t("Only in Batzio")}
          title={t("What bexio’s comparison doesn’t list")}
          text={t("Six things you get with Batzio that you won’t find in bexio’s package comparison.")}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {only.map((f) => (
            <div key={f.title} className="bg-card lift rounded-2xl border p-6 shadow-xs">
              <span className="bg-metal flex size-10 items-center justify-center rounded-xl text-white">
                <f.icon className="size-5" />
              </span>
              <h3 className="font-display mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="rows" className="mx-auto max-w-5xl scroll-mt-20 px-4 pb-16 sm:px-6">
        <SectionHeading
          id="rows"
          icon={Scale}
          kicker={t("Row by row")}
          title={t("bexio’s package comparison, with Batzio next to it")}
          text={t("“Coming soon” means it’s on our list but not in Batzio yet. “One day” means further out. A dash means bexio’s comparison doesn’t list it.")}
        />
        <ComparisonTable groups={groups} them="bexio" us="Batzio" />
      </section>

      <section aria-labelledby="year" className="bg-muted/40 scroll-mt-20 border-y px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            id="year"
            icon={Wallet}
            kicker={t("Pricing")}
            title={t("And it costs less")}
            text={t("bexio on the annual plan, excl. VAT. “Like for like” is the cheapest bexio package with what every Batzio plan includes, such as purchase orders, supplier bills and payroll.")}
          />
          <YearCosts />
          <p className="mt-6 text-center text-sm">
            <Link href="/pricing" className="text-primary inline-flex items-center gap-1 font-medium hover:underline">
              {t("See full pricing")} <ArrowRight className="size-3.5" />
            </Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="switch" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            id="switch"
            icon={Truck}
            kicker={t("1-click importer")}
            title={t("Moving over from bexio takes one click.")}
            text={t("Contacts, products, projects, invoices with their payments, bills, expenses and bookings come over with their numbers. Your bexio integrations keep working: change the address and the key.")}
          />
          <MoveInSteps />
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">
                <Truck /> {t("Start free and move in")}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section id="sources" className="mx-auto max-w-5xl scroll-mt-20 px-4 pb-16 sm:px-6">
        <div className="text-muted-foreground space-y-2 border-t pt-6 text-xs leading-5">
          <p>
            {t("About bexio, from bexio’s own pages, checked on {date}:", { date: CHECKED })}{" "}
            {SOURCES.map(([label, href], i) => (
              <span key={href}>
                {i > 0 && " · "}
                <a href={href} className="hover:text-foreground underline underline-offset-2" target="_blank" rel="noreferrer">
                  {label}
                </a>
              </span>
            ))}
          </p>
          <p>
            <Figures text={t("bexio prices are per month excl. VAT on the annual plan; the monthly plan costs CHF 10.– more. Where bexio’s pricing page and package comparison differ, we show the more generous one. Packages and prices can change, so check bexio’s site before deciding.")} />
          </p>
          <p>{t("bexio is a trademark of bexio AG. Batzio is not affiliated with bexio AG.")}</p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
