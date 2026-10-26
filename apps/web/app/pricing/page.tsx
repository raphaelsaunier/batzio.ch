import { ArrowRight, Calculator, Check, CircleHelp, Layers, Scale, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/chrome";
import { PriceCalculator } from "@/components/marketing/price-calculator";
import { PricingPlans } from "@/components/marketing/pricing";
import { YearCosts } from "@/components/marketing/year-costs";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { shareMetadata } from "@/lib/share";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Pricing"), ...(await shareMetadata("home")) };
}

export default async function PricingPage() {
  const t = await getT();
  const groups: [string, string[]][] = [
    [t("Sales"), [t("Quotes, orders, delivery notes, invoices, credit notes"), t("Swiss QR-bill"), t("Recurring invoices"), t("Reminders with fees")]],
    [t("Purchases & bank"), [t("Supplier bills"), t("Purchase orders"), t("Bank statements in, payments matched"), t("Pay bills with an ISO 20022 file")]],
    [
      t("Accounting & VAT"),
      [t("Double-entry books with the Swiss SME chart of accounts"), t("Balance sheet and income statement"), t("VAT: effective or net tax rate method, ESTV form"), t("Tamper-evident history of every change, with undo")],
    ],
    [t("Projects, stock & payroll"), [t("Projects, time tracking, billing the hours"), t("Stock with minimum levels"), t("Payslips with AHV/IV/EO, ALV, BVG and withholding tax")]],
    [t("Apps & AI"), [t("Batzi, on every screen, in four languages"), t("Claude, ChatGPT and other AI agents (MCP)"), t("Native apps"), t("Works offline")]],
    [t("Integrations"), [t("REST API"), t("Your integrations keep working."), t("Duplicate detection")]],
  ];
  const faq: [string, string][] = [
    [t("Is anything extra?"), t("No add-ons and no feature tiers: payroll, projects, stock, the AI assistant, the API and the apps come with every plan. The price only depends on how many people use Batzio.")],
    [t("What happens when we grow past five people?"), t("From the sixth person to the fiftieth, Batzio costs CHF 50.– a month in total, however many of you there are.")],
    [t("Are the offline apps really free?"), t("Yes. The desktop and mobile apps can keep a company’s books on your own device — no account, no subscription.")],
    [
      t("Can we run Batzio ourselves?"),
      t("Yes. Batzio is open source under the AGPL-3.0, and the instructions come with the source code. Batzio itself costs nothing; you pay for your own hosting and, if you want Batzi, your own Claude API key."),
    ],
    [
      t("Can I bring my data with me?"),
      t("Yes. Moving in from your current accounting software takes one click: contacts, products, projects, documents with payments, bills, expenses and bookings arrive with their numbers."),
    ],
    [t("And if I want to leave?"), t("PDFs, Excel exports of every list and report, and a complete API. Leave whenever you like — we’ll be sad, but we’ll hold the door.")],
  ];

  return (
    <div className="bg-background min-h-svh overflow-x-clip">
      <MarketingHeader home="/" />

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(ellipse_at_top,oklch(0.66_0.09_238/0.2),transparent_62%)]" />
        <div className="relative mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <span className="sticker">
              <Wallet className="text-primary size-3.5" /> {t("Pricing")}
            </span>
            <h1 className="font-display mt-5 text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl">{t("Fair prices. Free where it matters.")}</h1>
            <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg leading-8 text-balance">
              {t("Every plan has every feature — payroll, projects, stock, the AI assistant, the API. You only pay for the people who use it.")}
            </p>
          </div>
          <PricingPlans />
        </div>
      </section>

      <section aria-labelledby="calculator" className="bg-hero scroll-mt-20 border-y px-4 py-16 sm:px-6">
        <SectionHeading id="calculator" icon={Calculator} kicker={t("Calculator")} title={t("Work out your price")} text={t("Slide to the size of your team.")} />
        <PriceCalculator />
      </section>

      <section aria-labelledby="included" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
        <SectionHeading id="included" icon={Layers} kicker={t("Every plan")} title={t("Everything, in every plan")} text={t("No add-ons, no feature tiers: every plan comes with all of it.")} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(([title, items]) => (
            <div key={title} className="bg-card rounded-2xl border p-5 shadow-xs">
              <h3 className="font-display font-semibold">{title}</h3>
              <ul className="mt-3 space-y-2">
                {items.map((i) => (
                  <li key={i} className="text-muted-foreground flex gap-2 text-sm leading-6">
                    <Check className="text-success mt-1 size-4 shrink-0" /> {i}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="questions" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-16 sm:px-6">
        <SectionHeading id="questions" icon={CircleHelp} kicker={t("Questions")} title={t("Good to know")} text={t("The short answers about prices, free use and moving in.")} />
        <div className="neu-card divide-y">
          {faq.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
              </summary>
              <p className="text-muted-foreground mt-3 text-sm leading-6">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="year" className="bg-muted/40 scroll-mt-20 border-y px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            id="year"
            icon={Scale}
            kicker="Batzio vs bexio"
            title={t("What a year costs")}
            text={t("bexio on the annual plan, excl. VAT. “Like for like” is the cheapest bexio package with what every Batzio plan includes, such as purchase orders, supplier bills and payroll.")}
          />
          <YearCosts />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">{t("Start free — demo data included")}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/vs/bexio">
                {t("See the full comparison")} <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
