import { Building2, ChevronRight, LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { CreateCompanyForm } from "@/components/auth/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@batzio/core/permissions";
import { listMemberships } from "@batzio/server/control";
import { getControl, requireUser } from "@/lib/server/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Companies") };
}

export default async function SelectCompanyPage() {
  const t = await getT();
  const user = await requireUser();
  const memberships = await listMemberships(await getControl(), user.id);
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Your companies")}</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
        </div>
        <form action={logoutAction}>
          <Button variant="ghost" size="sm">
            <LogOut /> Sign out
          </Button>
        </form>
      </div>
      {memberships.length > 0 && (
        <div className="divide-y rounded-xl border bg-card">
          {memberships.map(({ tenant, role }) => (
            <Link key={tenant.id} href={`/${tenant.slug}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
              <span className="flex size-9 items-center justify-center rounded-lg bg-metal text-white">
                <Building2 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{tenant.name}</span>
                <span className="block truncate text-xs text-muted-foreground">/{tenant.slug}</span>
              </span>
              <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("New company")}</CardTitle>
          <CardDescription>{t("Each company gets its own isolated database, chart of accounts and VAT setup.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateCompanyForm />
        </CardContent>
      </Card>
    </div>
  );
}
