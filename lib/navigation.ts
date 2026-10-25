import { FAMILIES, friendlyResource, type UiMode } from "@/lib/friendly";
import { can, type Area, type Role } from "@/lib/permissions";
import { getResource, listResources, NAV_GROUPS } from "@/lib/resources/registry";

export interface NavItem {
  title: string;
  href: string;
  icon: string;
  /** Extra path prefixes that mark this item active. */
  match?: string[];
}

export interface NavSection {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
}

/** Extra, non-resource screens placed into navigation groups (accountant mode). */
const EXTRA: { group: string; order: number; title: string; path: string; icon: string; area: Area }[] = [
  { group: "overview", order: 2, title: "Insights", path: "/reports", icon: "BarChart3", area: "accounting" },
  { group: "banking", order: 15, title: "Import & export", path: "/banking/import", icon: "Upload", area: "banking" },
  { group: "payroll", order: 5, title: "Payroll run", path: "/payroll", icon: "Banknote", area: "payroll" },
];

const SETTINGS_ITEMS: { title: string; path: string; icon: string; area: Area }[] = [
  { title: "Company", path: "/settings", icon: "Settings", area: "settings" },
  { title: "Users & roles", path: "/settings/users", icon: "Users", area: "users" },
  { title: "API & MCP", path: "/settings/api", icon: "KeyRound", area: "settings" },
  { title: "Audit log", path: "/audit_log", icon: "ShieldCheck", area: "audit" },
];

function readable(role: Role, resource: string) {
  const res = getResource(resource);
  return !!res && can(role, res.area, "read");
}

/** A tiny sidebar of human destinations; related screens become tabs on the page. */
function simpleNavigation(slug: string, role: Role): NavSection[] {
  const base = `/${slug}`;
  const family = (id: string, title: string) => {
    const f = FAMILIES.find((x) => x.id === id)!;
    const members = f.members.filter((m) => readable(role, m));
    if (!members.length) return null;
    return {
      title,
      icon: f.icon,
      href: `${base}/${members[0]}`,
      match: [...members.map((m) => `${base}/${m}`), ...(f.extras ?? []).map((e) => `${base}${e.path}`)],
    } satisfies NavItem;
  };
  const sections: NavSection[] = [
    {
      id: "overview",
      label: "",
      icon: "Sun",
      items: [
        { title: "Today", href: base, icon: "Sun" },
        ...(can(role, "accounting", "read") ? [{ title: "Insights", href: `${base}/reports`, icon: "BarChart3" }] : []),
      ],
    },
    { id: "money", label: "Money", icon: "Coins", items: [family("get-paid", "Get paid"), family("pay", "Pay"), family("bank", "Bank")].filter(Boolean) as NavItem[] },
    { id: "work", label: "People & work", icon: "Users", items: [family("people", "People"), family("work", "Work"), family("team", "Team")].filter(Boolean) as NavItem[] },
    {
      id: "more",
      label: "More",
      icon: "Settings",
      items: [
        family("products", "Products"),
        readable(role, "files") ? { title: "Files", href: `${base}/files`, icon: "Paperclip" } : null,
        can(role, "settings", "read") ? { title: "Settings", href: `${base}/settings`, icon: "Settings", match: [`${base}/settings`, `${base}/audit_log`] } : null,
      ].filter(Boolean) as NavItem[],
    },
  ];
  return sections.filter((s) => s.items.length);
}

function accountantNavigation(slug: string, role: Role): NavSection[] {
  const base = `/${slug}`;
  const sections: NavSection[] = [];
  for (const group of NAV_GROUPS) {
    if (group.id === "settings") continue;
    const items: (NavItem & { order: number })[] = [];
    if (group.id === "overview") items.push({ title: "Today", href: base, icon: "Sun", order: 0 });
    for (const res of listResources()) {
      if (!res.nav || res.nav.group !== group.id || !can(role, res.area, "read")) continue;
      items.push({ title: res.labelPlural, href: `${base}/${res.name}`, icon: res.icon, order: res.nav.order });
    }
    for (const extra of EXTRA.filter((e) => e.group === group.id && can(role, e.area, "read"))) {
      items.push({ title: extra.title, href: `${base}${extra.path}`, icon: extra.icon, order: extra.order });
    }
    if (items.length) sections.push({ id: group.id, label: group.label, icon: group.icon, items: items.sort((a, b) => a.order - b.order) });
  }
  const settings = SETTINGS_ITEMS.filter((s) => can(role, s.area, "read")).map((s) => ({ title: s.title, href: `${base}${s.path}`, icon: s.icon }));
  if (settings.length) sections.push({ id: "settings", label: "Settings", icon: "Settings", items: settings });
  return sections;
}

export function buildNavigation(slug: string, role: Role, mode: UiMode = "simple"): NavSection[] {
  return mode === "simple" ? simpleNavigation(slug, role) : accountantNavigation(slug, role);
}

/** Tabs for the family a resource belongs to (e.g. Invoices · Quotes · Orders…). */
export function familyTabs(slug: string, role: Role, mode: UiMode, resource: string) {
  const family = FAMILIES.find((f) => f.members.includes(resource) || (f.extras ?? []).some((e) => e.path.slice(1) === resource));
  if (!family || (family.accountantOnly && mode === "simple")) return null;
  const tabs = family.members
    .filter((m) => readable(role, m))
    .map((m) => ({ key: m, title: friendlyResource(getResource(m)!, mode).labelPlural, href: `/${slug}/${m}` }));
  for (const e of family.extras ?? []) tabs.push({ key: e.path, title: e.title, href: `/${slug}${e.path}` });
  return { title: family.title, tabs };
}

/** Master data screens listed on the settings page. */
export function masterDataLinks(slug: string, role: Role): (NavItem & { description: string })[] {
  return listResources()
    .filter((r) => r.nav && r.nav.group === "settings" && can(role, r.area, "read"))
    .sort((a, b) => (a.nav ? a.nav.order : 0) - (b.nav ? b.nav.order : 0))
    .map((r) => ({ title: r.labelPlural, href: `/${slug}/${r.name}`, icon: r.icon, description: r.description }));
}
