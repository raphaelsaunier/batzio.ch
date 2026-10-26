import { ArrowRight, Bot, Calculator, Code, FileText, HeartHandshake, Landmark, LifeBuoy, Scale, ShoppingCart, Truck, Users, Wallet, WifiOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/chrome";
import { ComparisonTable, type Group } from "@/components/marketing/comparison";
import { MoveInSteps } from "@/components/marketing/sections";
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
      title: t("Price & freedom"),
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
        { label: t("Open source"), them: { mark: "no" }, us: { mark: "yes" }, win: true },
        { label: t("Run it on your own server"), them: { mark: "no", text: t("Cloud-based") }, us: { mark: "yes", text: t("Free") }, win: true },
        { label: t("Works offline"), them: { mark: "no", text: t("Cloud-based") }, us: { mark: "yes", text: t("Desktop and mobile apps, free forever") }, win: true },
        { label: t("Getting set up"), them: { text: t("Setup services from CHF 220.– each") }, us: { mark: "yes", text: t("Move in from bexio in one click, free") }, win: true },
      ],
    },
    {
      title: t("Apps & AI"),
      icon: Bot,
      rows: [
        { label: t("Web app"), them: { mark: "yes" }, us: { mark: "yes" } },
        { label: t("Native apps"), them: { mark: "yes", text: t("bexio Go for phones") }, us: { mark: "yes", text: "iPhone, iPad, Mac, Vision Pro, Android, Windows" }, win: true },
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
      title: t("Integrations"),
      icon: ShoppingCart,
      rows: [
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
  ];

  const years: [string, string, string, string][] = [
    [t("1 user"), `${chf("420.–")} · Basic`, `${chf("1’128.–")} · ${t("{package} + payroll", { package: "Optima" })}`, chf("60.–")],
    [t("5 users"), `${chf("828.–")} · Optima`, `${chf("1’128.–")} · ${t("{package} + payroll", { package: "Optima" })}`, chf("300.–")],
    [t("25 users"), `${chf("1’428.–")} · Ultimate`, `${chf("1’428.–")} · Ultimate`, chf("600.–")],
    [t("50 users"), t("On request"), t("On request"), chf("600.–")],
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
          <h1 className="font-display mt-5 text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl">{t("Swiss books like bexio. At a fraction of the price.")}</h1>
          <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg leading-8 text-balance">
            {t("Open source, works offline, free for non-profits, with an assistant that does the booking for you. Here’s how the two compare, row by row — including what we don’t do yet.")}
          </p>
          <div className="bg-border mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border text-left sm:grid-cols-4">
            {[
              [chf("5.–"), t("for one user a month. bexio: from CHF 35.–")],
              [chf("50.–"), t("for 25 users a month. bexio: CHF 119.–")],
              [chf("0.–"), t("for associations. bexio: 50 % off in the first year")],
              [t("Offline"), t("desktop and mobile apps, free. bexio is cloud-based")],
            ].map(([k, v]) => (
              <div key={v} className="bg-card p-5">
                <div className="font-display num text-2xl font-bold tracking-tight sm:text-3xl">{k}</div>
                <div className="text-muted-foreground mt-1 text-sm">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="year" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-14 sm:px-6">
        <SectionHeading
          id="year"
          icon={Wallet}
          kicker={t("Pricing")}
          title={t("What a year costs")}
          text={t("bexio on the annual plan, excl. VAT. “Like for like” is the cheapest bexio package with what every Batzio plan includes, such as purchase orders, supplier bills and payroll.")}
        />
        <div className="neu-card overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  {t("Team")}
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  {t("bexio, cheapest package")}
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  {t("bexio, like for like")}
                </th>
                <th scope="col" className="text-primary px-5 py-3 font-bold">
                  Batzio
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map(([team, cheapest, like, ours]) => (
                <tr key={team} className="border-b last:border-b-0">
                  <th scope="row" className="px-5 py-3.5 font-medium">
                    {team}
                  </th>
                  <td className="text-muted-foreground num px-5 py-3.5">{cheapest}</td>
                  <td className="text-muted-foreground num px-5 py-3.5">{like}</td>
                  <td className="num px-5 py-3.5 text-base font-bold">{ours}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

      <section aria-labelledby="switch" className="bg-hero scroll-mt-20 border-y py-20">
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
            <Button size="lg" variant="outline" asChild>
              <Link href="/#pricing">
                {t("See all prices")} <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-3 sm:px-6">
        {[
          { icon: Code, title: t("Open source"), text: t("Read every line, or run Batzio on your own server at no cost.") },
          { icon: WifiOff, title: t("Offline apps"), text: t("The desktop and mobile apps, with your books kept on your own device.") },
          { icon: HeartHandshake, title: t("Associations & non-profits"), text: t("Clubs, associations and non-profits use Batzio for free.") },
        ].map((f) => (
          <div key={f.title} className="bg-card rounded-2xl border p-6 shadow-xs">
            <span className="bg-metal flex size-10 items-center justify-center rounded-xl text-white">
              <f.icon className="size-5" />
            </span>
            <h3 className="font-display mt-4 text-lg font-semibold">{f.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-6">{f.text}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
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
          <p>{t("bexio prices are per month excl. VAT on the annual plan; the monthly plan costs CHF 10.– more. Where bexio’s pricing page and package comparison differ, we show the more generous one. Packages and prices can change, so check bexio’s site before deciding.")}</p>
          <p>{t("bexio is a trademark of bexio AG. Batzio is not affiliated with bexio AG.")}</p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
