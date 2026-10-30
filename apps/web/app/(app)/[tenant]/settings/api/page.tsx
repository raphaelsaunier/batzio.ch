import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { ApiKeyForm, CopyField, DisconnectButton, RevokeKeyButton } from "@/components/settings/team";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@batzio/core/format";
import { ROLE_LABELS } from "@batzio/core/permissions";
import { listApiKeys } from "@batzio/server/control";
import { listOauthGrants, publicOrigin } from "@batzio/server/oauth";
import { tenantCtx } from "@/lib/server/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Connections") };
}

export default async function ApiSettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await getT();
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  const [keys, grants] = await Promise.all([listApiKeys(ctx.control, ctx.tenant.id), listOauthGrants(ctx.control, ctx.tenant.id)]);
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = publicOrigin(new Request(`${proto}://${host}/`));
  const mcp = `${origin}/api/mcp`;
  const visibleKeys = ctx.role === "owner" || ctx.role === "admin" ? keys : keys.filter((k) => k.user_id === ctx.user?.id);
  const visibleGrants = ctx.role === "owner" || ctx.role === "admin" ? grants : grants.filter((g) => g.user_id === ctx.user?.id);

  return (
    <>
      <PageHeader
        title={t("Connections")}
        description={t("Connect assistants by signing in, or create a key for a script.")}
        crumbs={[{ label: t("Settings"), href: `/${tenant}/settings` }, { label: t("Connections") }]}
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
            <CardTitle>{t("Connect an assistant")}</CardTitle>
            <CardDescription>{t("Paste this address into Claude, ChatGPT or Cursor. A window opens for you to sign in and approve what it may do.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("Server address")}</span>
              <CopyField value={mcp} />
            </div>
            <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
              <li>{t("Copy the address")}</li>
              <li>{t("Add it as an MCP server in Claude, ChatGPT or Cursor")}</li>
              <li>{t("Approve access when the window opens")}</li>
            </ol>
          </CardContent>
        </Card>
        <Card className="overflow-hidden py-0 shadow-xs">
          <CardHeader className="border-b py-4">
            <CardTitle>{t("Connected apps")}</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("Name")}</TableHead>
                <TableHead>{t("Access")}</TableHead>
                <TableHead>{t("Created by")}</TableHead>
                <TableHead>{t("Last used")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleGrants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    {t("Nothing is connected yet.")}
                  </TableCell>
                </TableRow>
              )}
              {visibleGrants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.client_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{g.scope === "read" ? t("Read only") : t("Read & write")}</Badge>{" "}
                    <Badge variant="outline">{t(ROLE_LABELS[g.role])}</Badge>
                  </TableCell>
                  <TableCell>{g.user_name}</TableCell>
                  <TableCell className="text-muted-foreground">{g.last_used_at ? formatDateTime(g.last_used_at) : t("Never")}</TableCell>
                  <TableCell className="text-right">
                    <DisconnectButton tenant={tenant} id={g.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("API keys")}</CardTitle>
            <CardDescription>{t("For scripts and integrations that cannot sign in. A key never exceeds your own role, and every action it takes is recorded.")}</CardDescription>
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
              {visibleKeys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                    {t("No API keys yet.")}
                  </TableCell>
                </TableRow>
              )}
              {visibleKeys.map((k) => (
                <TableRow key={k.id} className={k.revoked_at ? "opacity-50" : undefined}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{k.scope === "read" ? t("Read only") : t("Read & write")}</Badge> <Badge variant="outline">{t(ROLE_LABELS[k.role])}</Badge>
                  </TableCell>
                  <TableCell>{k.user_name}</TableCell>
                  <TableCell className="text-muted-foreground">{k.last_used_at ? formatDateTime(k.last_used_at) : t("Never")}</TableCell>
                  <TableCell className="text-right">{k.revoked_at ? <Badge variant="outline">{t("Revoked")}</Badge> : <RevokeKeyButton tenant={tenant} id={k.id} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("REST API")}</CardTitle>
            <CardDescription>{t("Clients that cannot open a browser can use an API key as a bearer token.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("Base URL")}</span>
              <CopyField value={`${origin}/api/v1`} />
            </div>
            <p className="text-muted-foreground">
              Spec: <a className="text-primary hover:underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>
            </p>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
