import type { Metadata } from "next";
import Link from "next/link";
import { Composer, ExampleChips } from "@/components/batzi/composer";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { Batzi } from "@/components/fun/batzi";
import { Term } from "@/components/i18n/term";
import { PageBody } from "@/components/shell/page-header";
import { InboxAddress } from "@/components/today/inbox-address";
import { MoneyWeather } from "@/components/today/money-weather";
import { NudgeList, type ClientNudge } from "@/components/today/nudges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { greeting } from "@batzio/server/friendly";
import { formatAmount, formatDateTime, formatDuration } from "@batzio/core/format";
import { intlLocale, renderMsg } from "@batzio/i18n";
import { getLocale, getT } from "@/lib/i18n/server";
import { canCtx } from "@batzio/server/ctx";
import { getDashboard } from "@batzio/server/dashboard";
import { ensureInboxToken, inboxAddress } from "@batzio/server/email/inbound";
import { getEnv } from "@batzio/server/env";
import { getNudges, moneyWeather } from "@batzio/server/nudges";
import { tenantCtx } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { N_ } from "@batzio/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Today") };
}

const SOURCE: Record<string, string> = { ui: N_("You"), api: N_("API"), mcp: N_("MCP"), agent: N_("Batzi"), email: N_("Email"), system: N_("Batzio") };

export default async function TodayPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const base = `/${tenant}`;
  const finance = canCtx(ctx, "accounting", "read");
  const env = getEnv();
  const [d, nudges, weather] = await Promise.all([getDashboard(ctx), getNudges(ctx, base, locale), finance ? moneyWeather(ctx) : null]);
  const address = env.EMAIL_DOMAIN && canCtx(ctx, "files", "write") ? inboxAddress({ slug: tenant, inbox_token: await ensureInboxToken(ctx.control, ctx.tenant.id) }, env.EMAIL_DOMAIN) : null;

  const clientNudges: ClientNudge[] = nudges.map((n) => ({
    ...n,
    title: renderMsg(t, n.title),
    text: n.text && renderMsg(t, n.text),
    actions: n.actions.map((a) => ({ ...a, label: renderMsg(t, a.label), prompt: a.prompt && renderMsg(t, a.prompt) })),
  }));
  const firstName = ctx.user?.name.split(" ")[0] ?? "";
  const dateLine = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Zurich" }).format(new Date());

  const numbers = [
    finance && { term: "revenue", label: t("Revenue this year"), value: d.revenueYtd, href: `${base}/reports/income-statement` },
    finance && { term: "profit", label: t("Profit this year"), value: d.profitYtd, href: `${base}/reports/income-statement`, tone: d.profitYtd < 0 ? "text-destructive" : "text-success" },
    { term: "receivables", label: t("Customers owe you"), value: d.receivables.open, href: `${base}/invoices?status=open` },
    { term: "payables", label: t("You owe suppliers"), value: d.payables.open, href: `${base}/bills?status=booked` },
    finance && { term: "vat", label: t("VAT this quarter"), value: d.vat.payable, href: `${base}/reports/vat?from=${d.vat.from}&to=${d.vat.to}` },
  ].filter(Boolean) as { term: string; label: string; value: number; href: string; tone?: string }[];

  return (
    <PageBody className="space-y-8 pt-2">
      <section className="bg-hero relative overflow-hidden rounded-3xl border p-5 shadow-sm sm:p-8">
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-5">
            <div className="flex items-center gap-4">
              {/* Always a friendly hello: urgency is shown on the items under "Needs you", not on Batzi's face. */}
              <Batzi mood={nudges.length ? "wave" : "cool"} className="size-16 shrink-0 drop-shadow-md sm:size-20" />
              <div className="min-w-0">
                <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                  {greeting()}, {firstName}
                </h1>
                <p className="text-muted-foreground capitalize-first text-sm">
                  {ctx.tenant.name} · {dateLine}
                </p>
              </div>
            </div>
            <Composer />
            <ExampleChips />
            {address && <InboxAddress address={address} />}
          </div>
          {weather && <MoneyWeather weather={weather} className="w-full lg:w-[340px] lg:shrink-0" />}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">{t("Needs you")}</h2>
            <p className="text-muted-foreground text-sm">{t("Only the things Batzi can’t decide for you.")}</p>
          </div>
          {nudges.length > 0 && <span className="bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold">{nudges.length}</span>}
        </div>
        <NudgeList nudges={clientNudges} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {numbers.map((n) => (
          <Link key={n.term} href={n.href} className="bg-card rounded-2xl border p-4 shadow-xs transition-shadow hover:shadow-md">
            <p className="text-muted-foreground text-xs font-medium">
              <Term id={n.term}>{n.label}</Term>
            </p>
            <p className={cn("font-display num mt-1 text-xl font-semibold tracking-tight", n.tone)}>CHF {formatAmount(n.value)}</p>
          </Link>
        ))}
        {!finance && (
          <div className="bg-card rounded-2xl border p-4 shadow-xs">
            <p className="text-muted-foreground text-xs font-medium">
              <Term id="billable">{t("Unbilled time")}</Term>
            </p>
            <p className="font-display num mt-1 text-xl font-semibold">{formatDuration(d.unbilled.minutes)}</p>
          </div>
        )}
      </section>

      {finance && (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle className="font-display">{t("Money in, money out")}</CardTitle>
              <CardDescription>{t("Last 12 months, straight from the books")}</CardDescription>
            </CardHeader>
            <CardContent>
              <RevenueChart data={d.monthly} />
            </CardContent>
          </Card>
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle className="font-display">{t("Favourite customers")}</CardTitle>
              <CardDescription>{t("Invoiced this year, before VAT")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {d.topCustomers.length === 0 && <p className="text-muted-foreground text-sm">{t("No invoices yet.")}</p>}
              {d.topCustomers.map((c) => {
                const max = d.topCustomers[0]?.revenue || 1;
                return (
                  <Link key={c.id} href={`${base}/contacts/${c.id}`} className="block space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="num text-muted-foreground">{formatAmount(c.revenue)}</span>
                    </div>
                    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                      <div className="bg-metal h-full rounded-full" style={{ width: `${Math.max(4, (c.revenue / max) * 100)}%` }} />
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {canCtx(ctx, "audit", "read") && d.activity.length > 0 && (
        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-display">{t("What happened lately")}</CardTitle>
              <CardDescription>{t("Every change is in the tamper-proof log — who, what, when, and how.")}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`${base}/audit_log`}>{t("See all")}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="truncate">{a.summary}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    <span className={cn("mr-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase", a.source === "agent" ? "bg-primary/10 text-primary" : "bg-muted")}>{t(SOURCE[a.source] ?? a.source)}</span>
                    {a.actor_name} · {formatDateTime(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageBody>
  );
}
