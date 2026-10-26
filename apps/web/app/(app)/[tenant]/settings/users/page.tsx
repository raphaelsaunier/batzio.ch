import type { Metadata } from "next";
import { InviteForm, MemberControls } from "@/components/settings/team";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@batzio/core/format";
import { AREA_LABELS, AREAS, ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from "@batzio/core/permissions";
import { listInvitations, listMembers } from "@batzio/server/control";
import { assertCan, canCtx } from "@batzio/server/ctx";
import { tenantCtx } from "@/lib/server/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Users & roles") };
}

export default async function UsersPage({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await getT();
  const { tenant } = await params;
  const ctx = await tenantCtx(tenant);
  assertCan(ctx, "users", "read");
  const canManage = canCtx(ctx, "users", "write");
  const [members, invitations] = await Promise.all([listMembers(ctx.control, ctx.tenant.id), listInvitations(ctx.control, ctx.tenant.id)]);
  return (
    <>
      <PageHeader title={t("Users & roles")} description={t("Who has access to this company, and what they can do.")} crumbs={[{ label: t("Settings"), href: `/${tenant}/settings` }, { label: t("Users & roles") }]} />
      <PageBody>
        {canManage && (
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle>{t("Invite a colleague or your fiduciary")}</CardTitle>
              <CardDescription>{t("Existing Batzio users are added immediately; others receive an invitation link.")}</CardDescription>
            </CardHeader>
            <CardContent>
              <InviteForm tenant={tenant} />
            </CardContent>
          </Card>
        )}
        <Card className="overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("Name")}</TableHead>
                <TableHead>{t("Email")}</TableHead>
                <TableHead>{t("Last sign-in")}</TableHead>
                <TableHead className="text-right">{t("Role")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="font-medium">
                    {m.name} {m.user_id === ctx.user?.id && <Badge variant="secondary">{t("You")}</Badge>}
                  </TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell className="text-muted-foreground">{m.last_login_at ? formatDateTime(m.last_login_at) : "—"}</TableCell>
                  <TableCell>
                    <MemberControls tenant={tenant} userId={m.user_id} role={m.role} isSelf={m.user_id === ctx.user?.id} canManage={canManage} />
                  </TableCell>
                </TableRow>
              ))}
              {invitations.map((i) => (
                <TableRow key={i.id} className="text-muted-foreground">
                  <TableCell>
                    <Badge variant="outline">{t("Invited")}</Badge>
                  </TableCell>
                  <TableCell>{i.email}</TableCell>
                  <TableCell>expires {formatDateTime(i.expires_at)}</TableCell>
                  <TableCell className="text-right">{t(ROLE_LABELS[i.role as keyof typeof ROLE_LABELS] ?? i.role)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle>{t("Role permissions")}</CardTitle>
            <CardDescription>{t("Roles apply to the web app, the REST API and MCP alike.")}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2 pr-4 font-semibold">{t("Area")}</th>
                  {ROLES.map((r) => (
                    <th key={r} className="px-2 py-2 font-semibold">
                      {t(ROLE_LABELS[r])}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AREAS.map((a) => (
                  <tr key={a} className="border-t">
                    <td className="py-1.5 pr-4">{t(AREA_LABELS[a])}</td>
                    {ROLES.map((r) => {
                      const level = ROLE_PERMISSIONS[r][a];
                      return (
                        <td key={r} className="px-2 py-1.5">
                          <Badge variant="outline" className={level === "write" ? "border-success/30 bg-success/10 text-success" : level === "read" ? "border-info/30 bg-info/10 text-info" : "text-muted-foreground"}>
                            {level === "none" ? "—" : level === "write" ? t("read & write") : t("read")}
                          </Badge>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
