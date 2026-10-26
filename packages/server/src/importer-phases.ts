import { N_ } from "@batzio/i18n";

/** The steps of moving in, shared by the importer and the progress display (safe for client bundles). */
export const IMPORT_PHASES = [
  "company",
  "reference",
  "contacts",
  "archived_contacts",
  "relations",
  "items",
  "projects",
  "timesheets",
  "notes",
  "tasks",
  "quotes",
  "orders",
  "invoices",
  "bills",
  "expenses",
  "entries",
] as const;
export type ImportPhase = (typeof IMPORT_PHASES)[number];

export interface PhaseCount {
  imported: number;
  skipped: number;
  failed: number;
}

export interface ImportProgress {
  phase: ImportPhase | "done";
  cursor: number;
  counts: Partial<Record<ImportPhase, PhaseCount>>;
  warnings: string[];
  startedAt: string;
  finishedAt: string | null;
}

/** Labels for progress displays (translated by the UI). */
export const PHASE_LABELS: Record<ImportPhase, string> = {
  company: N_("Company profile"),
  reference: N_("Accounts, VAT codes and lists"),
  contacts: N_("Contacts"),
  archived_contacts: N_("Archived contacts"),
  relations: N_("Contact relations"),
  items: N_("Products & services"),
  projects: N_("Projects"),
  timesheets: N_("Time tracking"),
  notes: N_("Notes"),
  tasks: N_("Tasks"),
  quotes: N_("Quotes"),
  orders: N_("Sales orders"),
  invoices: N_("Invoices"),
  bills: N_("Supplier bills"),
  expenses: N_("Expenses"),
  entries: N_("Manual journal entries"),
};
