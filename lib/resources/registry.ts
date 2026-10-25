import { accountingResources } from "./defs/accounting";
import { bankingResources } from "./defs/banking";
import { contactResources } from "./defs/contacts";
import { inventoryResources } from "./defs/inventory";
import { masterResources } from "./defs/master";
import { payrollResources } from "./defs/payroll";
import { projectResources } from "./defs/projects";
import { purchaseResources } from "./defs/purchases";
import { documentResources, salesAuxResources } from "./defs/sales";
import { systemResources } from "./defs/system";
import type { NavGroup, ResourceDef } from "./types";

let cache: Map<string, ResourceDef> | null = null;

function build(): Map<string, ResourceDef> {
  const all = [
    ...contactResources,
    ...documentResources,
    ...salesAuxResources,
    ...purchaseResources,
    ...inventoryResources,
    ...accountingResources,
    ...bankingResources,
    ...projectResources,
    ...payrollResources,
    ...systemResources,
    ...masterResources,
  ];
  const map = new Map<string, ResourceDef>();
  for (const r of all) {
    if (map.has(r.name)) throw new Error(`Duplicate resource ${r.name}`);
    map.set(r.name, r);
  }
  return map;
}

/** All resources, keyed by API name. Built lazily to tolerate import cycles. */
export function resources(): Map<string, ResourceDef> {
  cache ??= build();
  return cache;
}

export function getResource(name: string): ResourceDef | undefined {
  return resources().get(name);
}

export function listResources(): ResourceDef[] {
  return [...resources().values()];
}

export const NAV_GROUPS: { id: NavGroup; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard" },
  { id: "contacts", label: "Contacts", icon: "Users" },
  { id: "sales", label: "Sales", icon: "Receipt" },
  { id: "purchases", label: "Purchases", icon: "ShoppingCart" },
  { id: "inventory", label: "Inventory", icon: "Package" },
  { id: "projects", label: "Projects & time", icon: "FolderKanban" },
  { id: "accounting", label: "Accounting", icon: "BookOpen" },
  { id: "banking", label: "Banking", icon: "Landmark" },
  { id: "payroll", label: "Payroll", icon: "IdCard" },
  { id: "settings", label: "Settings", icon: "Settings" },
];
