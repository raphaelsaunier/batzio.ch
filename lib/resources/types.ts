import type { Area } from "@/lib/permissions";
import type { Ctx } from "@/lib/server/ctx";

/**
 * A resource definition is the single source of truth for an entity. It drives
 * validation, persistence, the REST API, the OpenAPI document, MCP tools,
 * generic list/detail/form screens and spreadsheet exports.
 */

export type Row = Record<string, unknown>;

export type FieldType =
  | "string"
  | "text"
  | "email"
  | "url"
  | "phone"
  | "int"
  | "decimal"
  | "money"
  | "percent"
  | "date"
  | "datetime"
  | "time"
  | "boolean"
  | "enum"
  | "ref"
  | "tags"
  | "json"
  | "iban"
  | "color";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted" | "primary";

export interface FieldOption {
  value: string;
  label: string;
  tone?: Tone;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  /** Computed or system-managed; ignored on input. */
  readOnly?: boolean;
  /** Settable on create only. */
  createOnly?: boolean;
  default?: unknown;
  options?: FieldOption[];
  /** Target resource for `ref` (and `tags` of ids). */
  ref?: string;
  /** Extra equality filters applied when picking a referenced record. */
  refFilter?: Record<string, string | number | boolean>;
  /** Shown as a list column. */
  list?: boolean;
  /** Included in free-text search. */
  search?: boolean;
  /** Can be used as equality / range filter. */
  filter?: boolean;
  sortable?: boolean;
  placeholder?: string;
  /** Form section heading. */
  section?: string;
  /** Width in a 6-column form grid. */
  span?: 1 | 2 | 3 | 4 | 6;
  min?: number;
  max?: number;
  maxLength?: number;
  /** Hidden from generic forms (still part of the API). */
  hidden?: boolean;
  /** Display hint for list cells. */
  format?: "duration" | "code" | "strong";
  /** Glossary id for a jargon tooltip (derived from the English label when omitted). */
  term?: string | null;
}

export interface ChildDef {
  /** Property name in API payloads, e.g. `positions`. */
  name: string;
  label: string;
  table: string;
  foreignKey: string;
  orderBy: string;
  fields: FieldDef[];
}

export interface ActionResult {
  /** English template; `vars` fill its `{placeholders}`. */
  message?: string;
  vars?: Record<string, string | number>;
  /** Navigate to another record after the action (UI). */
  redirect?: { resource: string; id: number };
  data?: unknown;
}

export interface ActionDef {
  name: string;
  label: string;
  description: string;
  icon?: string;
  variant?: "default" | "outline" | "destructive" | "secondary";
  confirm?: string;
  /** Simple input form for the action. */
  input?: FieldDef[];
  /** Defaults to "write" on the resource area. */
  level?: "read" | "write";
  /** Whether the action applies to the record in its current state. */
  available?: (record: Row) => boolean;
  run: (ctx: Ctx, record: Row, input: Row) => Promise<ActionResult>;
}

export type NavGroup =
  | "overview"
  | "contacts"
  | "sales"
  | "purchases"
  | "inventory"
  | "accounting"
  | "banking"
  | "projects"
  | "payroll"
  | "settings";

export interface RelatedDef {
  resource: string;
  foreignKey: string;
  label: string;
}

export interface ResourceHooks {
  /** Runs after validation with DB-shaped data (cents, 0/1); may enrich or reject. */
  prepare?: (ctx: Ctx, data: Row, existing: Row | null) => Promise<Row> | Row;
  afterWrite?: (ctx: Ctx, record: Row, existing: Row | null) => Promise<void>;
  beforeDelete?: (ctx: Ctx, record: Row) => Promise<void>;
  /** Non-null when the record may no longer be edited. */
  lockReason?: (record: Row) => string | null;
}

export interface ResourceDef {
  /** URL & API segment, plural snake case: `invoices`. */
  name: string;
  /** Singular snake case used in MCP tool names: `invoice`. */
  singular: string;
  label: string;
  labelPlural: string;
  description: string;
  table: string;
  area: Area;
  icon: string;
  nav?: { group: NavGroup; order: number } | false;
  /** Fixed column values (where-clause and insert defaults), e.g. `{ kind: "invoice" }`. */
  scope?: Record<string, string | number>;
  fields: FieldDef[];
  children?: ChildDef[];
  /** SQL expression used as human-readable label. */
  titleSql: string;
  subtitleField?: string;
  defaultSort: { field: string; dir: "asc" | "desc" };
  softDelete?: boolean;
  numbering?: { field: string; sequence: string };
  readOnly?: boolean;
  noCreate?: boolean;
  noDelete?: boolean;
  actions?: ActionDef[];
  hooks?: ResourceHooks;
  /** Specialised detail view in the UI. */
  view?: "document" | "bill" | "entry" | "default";
  related?: RelatedDef[];
  /** Field holding the status for badges. */
  statusField?: string;
}
