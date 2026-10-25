import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { InboxCard } from "@/components/settings/inbox-card";
import { SequenceRow, SettingsForm } from "@/components/settings/settings-form";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { masterDataLinks } from "@/lib/navigation";
import { getT } from "@/lib/i18n/server";
import { translateField } from "@/lib/resources/client";
import { f, LANGUAGE_OPTIONS, opt } from "@/lib/resources/fields";
import { canCtx } from "@/lib/server/ctx";
import { DEFAULT_SEQUENCES, previewNumber, type SequenceRow as Seq } from "@/lib/server/numbering";
import { getSettings, LOCALIZED_TEXTS } from "@/lib/server/settings";
import { tenantCtx } from "@/lib/server/session";
import { ensureInboxToken, inboxAddress } from "@/lib/server/email/inbound";
import { getEnv } from "@/lib/server/env";
import { N_ } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Settings") };
}

const COMPANY_FIELDS = [
  f.string("name", "Company name", { span: 4 }),
  f.string("legal_form", "Legal form", { span: 2, placeholder: "AG, GmbH, Sàrl…" }),
  f.string("street", "Street", { span: 4 }),
  f.string("house_number", "No.", { span: 2 }),
  f.string("postcode", "Postcode", { span: 2 }),
  f.string("city", "City", { span: 2 }),
  f.string("country_code", "Country", { span: 2, maxLength: 2 }),
  f.phone("phone", "Phone", { span: 2 }),
  f.email("email", "Email", { span: 2 }),
  f.string("website", "Website", { span: 2 }),
  f.string("vat_number", "UID / VAT number", { span: 3, placeholder: "CHE-123.456.789 MWST" }),
  f.string("commercial_register", "Commercial register no.", { span: 3 }),
  f.enum("language", "Default document language", LANGUAGE_OPTIONS, { span: 3 }),
  f.color("accent_color", "Accent colour", { span: 3 }),
];

const TEXT_LABELS: Record<string, string> = {
  quote_header: N_("Quote: intro"),
  quote_footer: N_("Quote: closing"),
  order_header: N_("Order confirmation: intro"),
  invoice_header: N_("Invoice: intro"),
  invoice_footer: N_("Invoice: closing"),
  credit_note_header: N_("Credit note: intro"),
  delivery_header: N_("Delivery note: intro"),
  reminder_header: N_("Reminder: intro"),
};

const ACCOUNTING_FIELDS = [
  f.boolean("vat_registered", "Registered for VAT", { span: 2 }),
  f.enum("vat_method", "VAT method", [opt("effective", "Effective method"), opt("net_tax_rate", "Net tax rate method")], { span: 2 }),
  f.enum("vat_period", "VAT period", [opt("quarterly", "Quarterly"), opt("semiannual", "Semi-annual"), opt("monthly", "Monthly")], { span: 2 }),
  f.enum("chf_rounding", "Rounding", [opt("0.05", "5 Rappen (0.05)"), opt("0.01", "1 Rappen (0.01)")], { span: 2 }),
  f.int("default_payment_days", "Payment terms", { span: 2, description: "Days" }),
  f.int("quote_validity_days", "Quote validity (days)", { span: 2 }),
  f.int("reminder_days", "Reminder payment period (days)", { span: 2 }),
];

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  const t = await getT();
  const canWrite = canCtx(ctx, "settings", "write");
  const env = getEnv();
  const address = env.EMAIL_DOMAIN ? inboxAddress({ slug: tenant, inbox_token: await ensureInboxToken(ctx.control, ctx.tenant.id) }, env.EMAIL_DOMAIN) : null;
  const [company, accounting, texts] = await Promise.all([getSettings(ctx, "company"), getSettings(ctx, "accounting"), getSettings(ctx, "texts")]);
  const sequences = await ctx.db.all<Seq>("SELECT * FROM sequences");
  const lang = company.language;
  const textFields = (Object.keys(texts) as (keyof typeof texts)[]).map((k) =>
    translateField(f.text(k, TEXT_LABELS[k] ?? k, { span: 3 }), t),
  ).map((x) => ({ ...x, description: t("Default: “{text}…” (in each document’s language)", { text: LOCALIZED_TEXTS[lang][x.name as keyof typeof texts].slice(0, 70) }) }));

  return (
    <>
      <PageHeader title={t("Settings")} description={t("Or just tell Batzi: “change our address”, “invoices due in 20 days”, “number invoices RE-2026-001”.")} />
      <PageBody>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("Batzi & inbox")}</CardTitle>
            <CardDescription>{t("Everything here can also be set up by talking to Batzi or dropping a file.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <InboxCard tenant={tenant} address={address} agent={!!env.ANTHROPIC_API_KEY} canWrite={canWrite} />
          </CardContent>
        </Card>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("Company profile")}</CardTitle>
            <CardDescription>{t("Shown on documents, QR-bills and payment files.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm tenant={tenant} group="company" fields={COMPANY_FIELDS.map((x) => translateField(x, t))} initial={company as unknown as Record<string, unknown>} disabled={!canWrite} />
          </CardContent>
        </Card>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("Accounting & VAT")}</CardTitle>
            <CardDescription>{t("Defaults for documents, rounding and reminders.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm
              tenant={tenant}
              group="accounting"
              fields={ACCOUNTING_FIELDS.map((x) => translateField(x, t))}
              initial={{ ...accounting, chf_rounding: String(accounting.chf_rounding) } as unknown as Record<string, unknown>}
              disabled={!canWrite}
            />
          </CardContent>
        </Card>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("Document texts")}</CardTitle>
            <CardDescription>{t("Leave empty to use the built-in texts in the customer’s language (DE/FR/IT/EN).")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm tenant={tenant} group="texts" fields={textFields} initial={texts as unknown as Record<string, unknown>} disabled={!canWrite} />
          </CardContent>
        </Card>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("Number formats")}</CardTitle>
            <CardDescription>
              {t("Placeholders:")} <code>{"{YYYY}"}</code>, <code>{"{YY}"}</code>, <code>{"{MM}"}</code> {t("and a counter like")} <code>{"{####}"}</code>. {t("Formats with a year restart every year.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {await Promise.all(
              DEFAULT_SEQUENCES.map(async (d) => {
                const s = sequences.find((x) => x.key === d.key);
                return (
                  <SequenceRow
                    key={d.key}
                    tenant={tenant}
                    sequenceKey={d.key}
                    label={t(d.label)}
                    format={s?.format ?? d.format}
                    nextValue={s?.next_value ?? d.start ?? 1}
                    preview={await previewNumber(ctx, d.key)}
                    disabled={!canWrite}
                  />
                );
              }),
            )}
          </CardContent>
        </Card>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("Master data")}</CardTitle>
            <CardDescription>{t("Lists used throughout Batzio.")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {masterDataLinks(tenant, ctx.role).map((l) => (
              <Link key={l.href} href={l.href} className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Icon name={l.icon} className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{t(l.title)}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{t(l.description)}</span>
                </span>
              </Link>
            ))}
            {[
              { title: N_("Chart of accounts"), href: `/${tenant}/accounts`, icon: "BookOpen", description: N_("Ledger accounts (Swiss SME chart).") },
              { title: N_("VAT codes"), href: `/${tenant}/taxes`, icon: "Percent", description: N_("VAT rates, accounts and form digits.") },
              { title: N_("Business years"), href: `/${tenant}/business_years`, icon: "CalendarRange", description: N_("Open and close financial years.") },
              { title: N_("Bank accounts"), href: `/${tenant}/bank_accounts`, icon: "Landmark", description: N_("IBAN, QR-IBAN and ledger accounts.") },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Icon name={l.icon} className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{t(l.title)}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{t(l.description)}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
