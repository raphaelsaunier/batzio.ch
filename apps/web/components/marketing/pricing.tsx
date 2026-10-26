import { ArrowRight, Check, Code, HeartHandshake, WifiOff } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { Figures } from "./figures";

/** The whole price list in one row, for the landing page; the details live on /pricing. */
export async function PricingSummary() {
  const t = await getT();
  const cells = [
    { label: t("1 to 5 users"), price: "CHF 5.–", unit: t("per user and month") },
    { label: t("6 to 50 users"), price: "CHF 50.–", unit: t("per month, all in") },
    { label: t("Offline apps, self-hosting and non-profits"), price: t("Free"), unit: t("forever") },
  ];
  return (
    <div className="mx-auto max-w-4xl">
      <h2 id="pricing" className="sr-only">
        {t("Pricing")}
      </h2>
      <dl className="neu-card grid divide-y overflow-hidden text-left sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {cells.map((c) => (
          <div key={c.label} className="flex flex-col gap-1 p-5">
            <dt className="text-muted-foreground text-sm">{c.label}</dt>
            <dd className="font-display num text-3xl font-semibold tracking-tight">{c.price}</dd>
            <dd className="text-muted-foreground text-sm">{c.unit}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground mt-3 text-center text-sm">
        {t("Every plan has every feature.")}{" "}
        <Link href="/pricing" className="text-primary inline-flex items-center gap-1 font-medium hover:underline">
          {t("See full pricing")} <ArrowRight className="size-3.5" />
        </Link>
      </p>
    </div>
  );
}

/** The plans in detail: per person for small teams, one flat price up to 50, free where it matters. */
export async function PricingPlans() {
  const t = await getT();
  const plans = [
    { name: t("Small teams"), price: "5.–", unit: t("per user and month"), detail: t("1 to 5 users, so CHF 25.– a month at most."), featured: false },
    { name: t("Growing teams"), price: "50.–", unit: t("per month, all in"), detail: t("6 to 50 users, one flat price."), featured: true },
  ];
  const included = [t("Payroll"), t("Projects & time"), t("Stock"), t("Batzi, the AI assistant"), t("API & MCP"), t("Native apps")];
  const free = [
    { icon: WifiOff, title: t("Offline apps"), text: t("The desktop and mobile apps, with your books kept on your own device.") },
    { icon: Code, title: t("Open source"), text: t("Read every line, or run Batzio on your own server at no cost.") },
    { icon: HeartHandshake, title: t("Associations & non-profits"), text: t("Clubs, associations and non-profits use Batzio for free.") },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-3">
        {plans.map((p) => (
          <div key={p.name} className={cn("neu-card flex flex-col p-6", p.featured && "ring-primary/40 ring-2")}>
            <h3 className="font-display text-lg font-semibold">{p.name}</h3>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="text-muted-foreground text-sm font-semibold">CHF</span>
              <span className="font-display num text-5xl font-semibold tracking-tight">{p.price}</span>
            </p>
            <p className="text-muted-foreground text-sm">{p.unit}</p>
            <p className="mt-4 text-sm leading-6">
              <Figures text={p.detail} />
            </p>
            <ul className="mt-5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-4">
              {included.map((i) => (
                <li key={i} className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Check className="text-success size-3.5 shrink-0" /> {i}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="bg-metal flex flex-col rounded-3xl p-6 text-white">
          <h3 className="font-display text-lg font-semibold">{t("Free, forever")}</h3>
          <ul className="mt-4 space-y-4">
            {free.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <f.icon className="size-4" />
                </span>
                <div>
                  <p className="font-semibold">{f.title}</p>
                  <p className="text-sm leading-6 text-white/80">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-muted-foreground text-center text-sm">{t("Every plan has every feature. Prices in Swiss francs.")}</p>
    </div>
  );
}
