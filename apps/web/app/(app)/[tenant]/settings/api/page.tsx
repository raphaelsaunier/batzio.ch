import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { ApiKeyForm, CopyField, RevokeKeyButton } from "@/components/settings/team";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@batzio/core/format";
import { ROLE_LABELS } from "@batzio/core/permissions";
import { listApiKeys } from "@batzio/server/control";
import { tenantCtx } from "@/lib/server/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("API & MCP") };
}

export default async function ApiSettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await getT();
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  const keys = await listApiKeys(ctx.control, ctx.tenant.id);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? (h.get("host")?.startsWith("localhost") ? "http" : "https")}://${h.get("host")}`;
  const mcpConfig = JSON.stringify(
    { mcpServers: { batzio: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: "Bearer <your API key>" } } } },
    null,
    2,
  );
  const visible = ctx.role === "owner" || ctx.role === "admin" ? keys : keys.filter((k) => k.user_id === ctx.user?.id);

  return (
    <>
      <PageHeader
        title={t("API & MCP")}
        description={t("Connect integrations and AI assistants to this company.")}
        crumbs={[{ label: t("Settings"), href: `/${tenant}/settings` }, { label: t("API & MCP") }]}
        actions={
          <Button variant="outline" asChild>
            <Link href="/docs/api" target="_blank">
              {t("API reference")}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("Create an API key")}</CardTitle>
            <CardDescription>Keys are bound to {ctx.tenant.name}, never exceed your own role, and every action they take is audited.</CardDescription>
          </CardHeader>
          <CardContent>
            <ApiKeyForm tenant={tenant} maxRole={ctx.role} />
          </CardContent>
        </Card>
        <Card className="overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("Name")}</TableHead>
                <TableHead>{t("Key")}</TableHead>
                <TableHead>{t("Access")}</TableHead>
                <TableHead>{t("Created by")}</TableHead>
                <TableHead>{t("Last used")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                    {t("No API keys yet.")}
                  </TableCell>
                </TableRow>
              )}
              {visible.map((k) => (
                <TableRow key={k.id} className={k.revoked_at ? "opacity-50" : undefined}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{k.scope === "read" ? t("Read only") : t("Read & write")}</Badge> <Badge variant="outline">{t(ROLE_LABELS[k.role])}</Badge>
                  </TableCell>
                  <TableCell>{k.user_name}</TableCell>
                  <TableCell className="text-muted-foreground">{k.last_used_at ? formatDateTime(k.last_used_at) : t("Never")}</TableCell>
                  <TableCell className="text-right">{k.revoked_at ? <Badge variant="outline">Revoked</Badge> : <RevokeKeyButton tenant={tenant} id={k.id} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle>{t("REST API")}</CardTitle>
              <CardDescription>{t("OpenAPI 3.1 — every list, record, workflow action, report and export.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">{t("Base URL")}</span>
                <CopyField value={`${origin}/api/v1`} />
              </div>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{`curl ${origin}/api/v1/invoices?status=open \\
  -H "Authorization: Bearer bz_…"`}</pre>
              <p className="text-muted-foreground">
                Spec: <a className="text-primary hover:underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle>{t("MCP for AI assistants")}</CardTitle>
              <CardDescription>{t("Streamable HTTP endpoint with tools for search, records, workflows and reports.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">{t("Server URL")}</span>
                <CopyField value={`${origin}/api/mcp`} />
              </div>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{mcpConfig}</pre>
              <p className="text-muted-foreground">
                Claude Code: <code className="rounded bg-muted px-1">claude mcp add --transport http batzio {origin}/api/mcp --header &quot;Authorization: Bearer bz_…&quot;</code>
              </p>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
