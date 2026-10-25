import { BatziPanel, DropOverlay } from "@/components/batzi/batzi-panel";
import { BatziProvider } from "@/components/batzi/batzi-provider";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { CommandMenu } from "@/components/shell/command-menu";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { buildNavigation } from "@/lib/navigation";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { listMemberships } from "@/lib/server/control";
import { getMode } from "@/lib/server/mode";
import { getEnv } from "@/lib/server/env";
import { getControl, getMembershipFor } from "@/lib/server/session";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const { user, membership } = await getMembershipFor(tenant);
  const [memberships, mode] = await Promise.all([listMemberships(await getControl(), user.id), getMode()]);
  const canUseGoggles = can(membership.role, "accounting", "read");
  const effectiveMode = canUseGoggles ? mode : "simple";
  const sections = buildNavigation(tenant, membership.role, effectiveMode);

  return (
    <BatziProvider tenant={tenant} agent={!!getEnv().ANTHROPIC_API_KEY}>
    <SidebarProvider>
      <AppSidebar
        sections={sections}
        company={{ slug: tenant, name: membership.tenant.name, role: ROLE_LABELS[membership.role] }}
        companies={memberships.map((m) => ({ slug: m.tenant.slug, name: m.tenant.name, role: ROLE_LABELS[m.role] }))}
        user={{ name: user.name, email: user.email }}
        mode={effectiveMode}
        canUseGoggles={canUseGoggles}
      />
      <SidebarInset className="min-w-0 bg-transparent">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 px-4 backdrop-blur-md md:px-6">
          <SidebarTrigger className="-ml-1 rounded-lg" />
          <CommandMenu tenant={tenant} sections={sections} />
          <LocaleSwitcher compact className="ml-auto hidden sm:inline-flex" />
        </header>
        <div className="flex-1">{children}</div>
      </SidebarInset>
      <BatziPanel />
      <DropOverlay />
    </SidebarProvider>
    </BatziProvider>
  );
}
