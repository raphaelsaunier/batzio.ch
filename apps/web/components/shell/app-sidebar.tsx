"use client";

import { Building2, Check, ChevronsUpDown, FileCode2, Glasses, LogOut, Moon, Plus, Sparkles, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useTransition } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { setModeAction } from "@/app/(app)/[tenant]/actions";
import { Batzi } from "@/components/fun/batzi";
import { Icon } from "@/components/icon";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import type { UiMode } from "@batzio/server/friendly";
import type { NavItem, NavSection } from "@batzio/server/navigation";
import { useT } from "@batzio/i18n/react";

export interface SidebarCompany {
  slug: string;
  name: string;
  role: string;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function openQuickEntry() {
  window.dispatchEvent(new CustomEvent("batzio:quick"));
}

export function AppSidebar({
  sections,
  company,
  companies,
  user,
  mode,
  canUseGoggles,
}: {
  sections: NavSection[];
  company: SidebarCompany;
  companies: SidebarCompany[];
  user: { name: string; email: string };
  mode: UiMode;
  canUseGoggles: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { state } = useSidebar();
  const [pending, start] = useTransition();
  const base = `/${company.slug}`;
  const isActive = (item: NavItem) => {
    if (item.href === base) return pathname === base;
    const prefixes = [item.href, ...(item.match ?? [])];
    return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  };

  return (
    <Sidebar collapsible="icon" variant="floating" className="[&_[data-slot=sidebar-inner]]:border-sidebar-border [&_[data-slot=sidebar-inner]]:shadow-soft">
      <SidebarHeader className="gap-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="rounded-xl data-[state=open]:bg-sidebar-accent">
                  <Batzi mood="happy" className="size-9 animate-float" />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-display text-[0.95rem] font-semibold text-sidebar-accent-foreground">{company.name}</span>
                    <span className="truncate text-xs text-sidebar-foreground/70">{t(company.role)}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 opacity-50" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 rounded-xl" align="start" side="bottom">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t("Your companies")}</DropdownMenuLabel>
                {companies.map((c) => (
                  <DropdownMenuItem key={c.slug} asChild>
                    <Link href={`/${c.slug}`}>
                      <Building2 /> <span className="truncate">{c.name}</span>
                      {c.slug === company.slug && <Check className="ml-auto" />}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/select">
                    <Plus /> {t("Another company")}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        {state === "expanded" ? (
          <Button onClick={openQuickEntry} className="h-10 justify-start gap-2 rounded-xl bg-metal text-white shadow-soft hover:opacity-95">
            <Sparkles className="size-4" />
            <span className="flex-1 text-left">{t("Tell Batzio…")}</span>
            <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 text-[0.65rem] font-medium">⌘K</kbd>
          </Button>
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t("Tell Batzio (⌘K)")} onClick={openQuickEntry} className="bg-metal text-white hover:text-white">
                <Sparkles />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {sections.map((section) => (
          <SidebarGroup key={section.id} className="py-1">
            {section.label && (
              <SidebarGroupLabel className="text-[0.7rem] font-semibold tracking-wide text-sidebar-foreground/55">{t(section.label)}</SidebarGroupLabel>
            )}
            <SidebarMenu className="gap-0.5">
              {section.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item)}
                    tooltip={t(item.title)}
                    className="h-9 rounded-xl text-[0.9rem] transition-all data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-soft"
                  >
                    <Link href={item.href}>
                      <Icon name={item.icon} />
                      <span>{t(item.title)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-2">
        {canUseGoggles && state === "expanded" && (
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-sidebar-border px-3 py-2 text-xs text-sidebar-foreground">
            <Glasses className="size-4 shrink-0" />
            <span className="flex-1 leading-tight">
              <span className="block font-semibold text-sidebar-accent-foreground">{t("Accountant goggles")}</span>
              <span className="opacity-75">{mode === "accountant" ? t("Ledger, VAT codes & jargon on") : t("Show the ledger & jargon")}</span>
            </span>
            <Switch
              checked={mode === "accountant"}
              disabled={pending}
              onCheckedChange={(v) =>
                start(async () => {
                  await setModeAction(v ? "accountant" : "simple");
                  router.refresh();
                })
              }
            />
          </label>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="rounded-xl data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-8 rounded-full">
                    <AvatarFallback className="rounded-full bg-metal text-xs font-semibold text-white">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium text-sidebar-accent-foreground">{user.name}</span>
                    <span className="truncate text-xs text-sidebar-foreground/70">{user.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 opacity-50" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60 rounded-xl" side="top" align="start">
                <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                  {resolvedTheme === "dark" ? <Sun /> : <Moon />} {resolvedTheme === "dark" ? t("Daylight, please") : t("Night mode")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/docs/api" target="_blank">
                    <FileCode2 /> {t("API reference")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logoutAction()}>
                  <LogOut /> {t("Sign out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
