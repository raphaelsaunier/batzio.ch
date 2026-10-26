import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatAmount, formatDateTime, formatDuration, today } from "@batzio/core/format";
import type { ResourceDef, Row } from "@batzio/server/resources/types";
import { accountBalances } from "@batzio/server/accounting";
import type { Ctx } from "@batzio/server/ctx";
import { projectStats } from "@batzio/server/projects";
import { formatQrReference, formatScorReference } from "@batzio/core/swiss/references";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { Term } from "@/components/i18n/term";
import { N_ } from "@batzio/i18n";

/** A label/value line; the (English) label is translated and explained when it is jargon. */
async function Line({ label, value, strong, tone }: { label: string; value: React.ReactNode; strong?: boolean; tone?: "danger" | "success" }) {
  const t = await getT();
  return (
    <div className={cn("flex items-baseline justify-between gap-4 text-sm", strong && "font-semibold")}>
      <span className="text-muted-foreground">
        <Term label={label}>{t(label)}</Term>
      </span>
      <span className={cn("num text-right", tone === "danger" && "text-destructive", tone === "success" && "text-success")}>{value}</span>
    </div>
  );
}

/** Context panel next to a record: totals, links and metadata. */
export async function RecordAside({ ctx, res, record }: { ctx: Ctx; res: ResourceDef; record: Row }) {
  const t = await getT();
  const tenant = ctx.tenant.slug;
  const blocks: React.ReactNode[] = [];
  const currency = String(record.currency_code ?? "CHF");

  if (res.view === "document") {
    const overdue = ["open", "partial"].includes(String(record.status)) && record.due_date && String(record.due_date) < today();
    blocks.push(
      <Card key="totals" className="gap-3 py-4 shadow-xs">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Amounts ({currency})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 px-4">
          <Line label="Net" value={formatAmount(Number(record.total_net))} />
          <Line label="VAT" value={formatAmount(Number(record.total_vat))} />
          {Number(record.rounding) !== 0 && <Line label="Rounding" value={formatAmount(Number(record.rounding))} />}
          <div className="border-t pt-1.5">
            <Line label="Total" value={formatAmount(Number(record.total))} strong />
          </div>
          {(res.name === "invoices" || res.name === "credit_notes") && record.status !== "draft" && (
            <>
              <Line label={res.name === "credit_notes" ? N_("Refunded") : N_("Paid")} value={formatAmount(Number(record.amount_paid))} tone="success" />
              <Line label="Open" value={formatAmount(Number(record.amount_open))} strong tone={overdue ? "danger" : undefined} />
              {overdue && <p className="text-xs text-destructive">Overdue since {String(record.due_date).split("-").reverse().join(".")}</p>}
            </>
          )}
        </CardContent>
      </Card>,
    );
    const links: React.ReactNode[] = [];
    if (record.qr_reference) {
      const ref = String(record.qr_reference);
      links.push(<Line key="qr" label="QR reference" value={<span className="font-mono text-xs">{ref.startsWith("RF") ? formatScorReference(ref) : formatQrReference(ref)}</span>} />);
    }
    if (record.source_id) {
      const src = await ctx.db.first<{ kind: string; nr: string | null }>("SELECT kind, nr FROM documents WHERE id = ?", record.source_id);
      const map: Record<string, string> = { quote: "quotes", order: "orders", invoice: "invoices", delivery: "deliveries", credit_note: "credit_notes", purchase_order: "purchase_orders" };
      if (src) links.push(<Line key="src" label="Created from" value={<Link className="text-primary hover:underline" href={`/${tenant}/${map[src.kind]}/${record.source_id}`}>{src.nr ?? `#${record.source_id}`}</Link>} />);
    }
    const derived = await ctx.db.all<{ id: number; kind: string; nr: string | null }>("SELECT id, kind, nr FROM documents WHERE source_id = ? ORDER BY id", record.id);
    for (const d of derived) {
      const map: Record<string, string> = { quote: "quotes", order: "orders", invoice: "invoices", delivery: "deliveries", credit_note: "credit_notes", purchase_order: "purchase_orders" };
      links.push(<Line key={`d${d.id}`} label={`→ ${t({ quote: N_("Quote"), order: N_("Order"), delivery: N_("Delivery note"), invoice: N_("Invoice"), credit_note: N_("Credit note"), purchase_order: N_("Purchase order") }[d.kind] ?? d.kind)}`} value={<Link className="text-primary hover:underline" href={`/${tenant}/${map[d.kind]}/${d.id}`}>{d.nr ?? `#${d.id}`}</Link>} />);
    }
    if (record.journal_entry_id) {
      links.push(<Line key="je" label="Booking" value={<Link className="text-primary hover:underline" href={`/${tenant}/journal_entries/${record.journal_entry_id}`}>{t("Journal entry")}</Link>} />);
    }
    if (links.length) {
      blocks.push(
        <Card key="links" className="gap-3 py-4 shadow-xs">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("References")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 px-4">{links}</CardContent>
        </Card>,
      );
    }
  }

  if (res.name === "bills") {
    blocks.push(
      <Card key="bill" className="gap-3 py-4 shadow-xs">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Amounts ({currency})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 px-4">
          <Line label="Net" value={formatAmount(Number(record.total_net))} />
          <Line label="Input VAT" value={formatAmount(Number(record.total_vat))} />
          <div className="border-t pt-1.5">
            <Line label="Total" value={formatAmount(Number(record.total))} strong />
          </div>
          <Line label="Paid" value={formatAmount(Number(record.amount_paid))} tone="success" />
          <Line label="Open" value={formatAmount(Number(record.amount_open))} strong />
          {record.journal_entry_id ? (
            <Link className="block pt-1 text-sm text-primary hover:underline" href={`/${tenant}/journal_entries/${record.journal_entry_id}`}>
              {t("View booking →")}
            </Link>
          ) : null}
        </CardContent>
      </Card>,
    );
  }

  if (res.name === "projects") {
    const s = await projectStats(ctx, record);
    blocks.push(
      <Card key="project" className="gap-3 py-4 shadow-xs">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("Project figures")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 px-4">
          <Line label="Time logged" value={formatDuration(s.minutes)} />
          <Line label="Billable" value={formatDuration(s.billableMinutes)} />
          <Line label="Not yet invoiced" value={formatDuration(s.unbilledMinutes)} strong />
          <Line label="Invoiced (net)" value={formatAmount(s.invoiced)} />
          <Line label="Costs" value={formatAmount(s.costs)} />
          {s.budgetUsedPercent !== null && (
            <div className="space-y-1 pt-2">
              <Line label="Budget used" value={`${s.budgetUsedPercent}%`} tone={s.budgetUsedPercent > 100 ? "danger" : undefined} />
              <Progress value={Math.min(100, s.budgetUsedPercent)} />
            </div>
          )}
        </CardContent>
      </Card>,
    );
  }

  if (res.name === "accounts") {
    const year = today().slice(0, 4);
    const bal = (await accountBalances(ctx, `${year}-01-01`, today())).find((b) => b.id === Number(record.id));
    blocks.push(
      <Card key="account" className="gap-3 py-4 shadow-xs">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Balance {year}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 px-4">
          {bal && (
            <>
              <Line label="Opening" value={formatAmount(bal.opening)} />
              <Line label="Debit" value={formatAmount(bal.debit)} />
              <Line label="Credit" value={formatAmount(bal.credit)} />
              <Line label="Balance" value={formatAmount(bal.balance)} strong />
            </>
          )}
          <Link className="block pt-1 text-sm text-primary hover:underline" href={`/${tenant}/reports/ledger?account=${record.id}`}>
            {t("Open account ledger →")}
          </Link>
        </CardContent>
      </Card>,
    );
  }

  if (res.name === "payslips") {
    const rows: [string, string][] = [
      [N_("Gross salary"), "gross"],
      [N_("AHV/IV/EO"), "ahv"],
      [N_("ALV"), "alv"],
      [N_("BVG"), "bvg"],
      [N_("NBU"), "nbu"],
      [N_("KTG"), "ktg"],
      [N_("Withholding tax"), "withholding_tax"],
      [N_("Allowances"), "allowances"],
    ];
    blocks.push(
      <Card key="slip" className="gap-3 py-4 shadow-xs">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{t("Payslip")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 px-4">
          {rows.map(([label, key]) => (
            <Line key={key} label={label} value={(key === "gross" || key === "allowances" ? "" : "– ") + formatAmount(Number(record[key]))} />
          ))}
          <div className="border-t pt-1.5">
            <Line label="Net salary" value={formatAmount(Number(record.net))} strong />
          </div>
          <Line label="Employer cost" value={formatAmount(Number(record.employer_cost))} />
        </CardContent>
      </Card>,
    );
  }

  blocks.push(
    <Card key="meta" className="gap-2 py-4 shadow-xs">
      <CardContent className="space-y-1 px-4 text-xs text-muted-foreground">
        {record.created_at ? (
          <p>{record.created_by ? t("Created {date} by {who}", { date: formatDateTime(String(record.created_at)), who: String(record.created_by) }) : t("Created {date}", { date: formatDateTime(String(record.created_at)) })}</p>
        ) : null}
        {record.updated_at ? (
          <p>{record.updated_by ? t("Updated {date} by {who}", { date: formatDateTime(String(record.updated_at)), who: String(record.updated_by) }) : t("Updated {date}", { date: formatDateTime(String(record.updated_at)) })}</p>
        ) : null}
        <p>
          API: <code className="rounded bg-muted px-1">/api/v1/{res.name}/{String(record.id)}</code>
        </p>
      </CardContent>
    </Card>,
  );

  return <div className="space-y-4">{blocks}</div>;
}
