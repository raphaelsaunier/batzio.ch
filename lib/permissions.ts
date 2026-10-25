/** Role-based access control shared by UI, REST API and MCP. */

export const ROLES = ["owner", "admin", "accountant", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const AREAS = [
  "contacts",
  "sales",
  "purchases",
  "inventory",
  "accounting",
  "banking",
  "projects",
  "payroll",
  "files",
  "settings",
  "users",
  "audit",
] as const;
export type Area = (typeof AREAS)[number];

export type Level = "none" | "read" | "write";

const ALL_WRITE = Object.fromEntries(AREAS.map((a) => [a, "write"])) as Record<Area, Level>;

export const ROLE_PERMISSIONS: Record<Role, Record<Area, Level>> = {
  owner: ALL_WRITE,
  admin: ALL_WRITE,
  accountant: {
    ...ALL_WRITE,
    settings: "read",
    users: "read",
  },
  member: {
    contacts: "write",
    sales: "write",
    purchases: "read",
    inventory: "write",
    accounting: "none",
    banking: "none",
    projects: "write",
    payroll: "none",
    files: "write",
    settings: "read",
    users: "none",
    audit: "none",
  },
  viewer: {
    contacts: "read",
    sales: "read",
    purchases: "read",
    inventory: "read",
    accounting: "read",
    banking: "read",
    projects: "read",
    payroll: "none",
    files: "read",
    settings: "read",
    users: "none",
    audit: "none",
  },
};

export const AREA_LABELS: Record<Area, string> = {
  contacts: "Contacts",
  sales: "Sales",
  purchases: "Purchases",
  inventory: "Products & stock",
  accounting: "Accounting",
  banking: "Banking",
  projects: "Projects & time",
  payroll: "Payroll",
  files: "Files",
  settings: "Settings",
  users: "Users & roles",
  audit: "Audit log",
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Administrator",
  accountant: "Accountant",
  member: "Member",
  viewer: "Viewer",
};

const RANK: Record<Level, number> = { none: 0, read: 1, write: 2 };

export function can(role: Role, area: Area, level: Exclude<Level, "none"> = "read"): boolean {
  const granted = ROLE_PERMISSIONS[role]?.[area] ?? "none";
  return RANK[granted] >= RANK[level];
}

/** Returns the lower of two roles (used to cap API keys to their creator's role). */
export function minRole(a: Role, b: Role): Role {
  return ROLES.indexOf(a) >= ROLES.indexOf(b) ? a : b;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
