import { createT, type TFunction } from "@batzio/i18n";
import { termFor } from "@batzio/i18n/glossary";
import type { Area } from "@batzio/core/permissions";
import type { ChildDef, FieldDef, RelatedDef, ResourceDef, Row } from "./types";

/** Serializable subset of a resource definition for client components. */
export interface ClientAction {
  name: string;
  label: string;
  description: string;
  icon?: string;
  variant?: "default" | "outline" | "destructive" | "secondary";
  confirm?: string;
  input?: FieldDef[];
}

export interface ClientResource {
  name: string;
  singular: string;
  label: string;
  labelPlural: string;
  description: string;
  icon: string;
  area: Area;
  fields: FieldDef[];
  children: ChildDef[];
  actions: ClientAction[];
  related: RelatedDef[];
  statusField?: string;
  view: NonNullable<ResourceDef["view"]>;
  softDelete: boolean;
  readOnly: boolean;
  noCreate: boolean;
  noDelete: boolean;
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Translates a field for display and attaches its glossary term. */
export function translateField(field: FieldDef, t: TFunction): FieldDef {
  return {
    ...field,
    term: field.term ?? termFor(field.label) ?? termFor(field.name.replace(/_id$/, "").replace(/_/g, " ")),
    label: t(field.label),
    description: field.description && t(field.description),
    placeholder: field.placeholder && t(field.placeholder),
    section: field.section && t(field.section),
    options: field.options?.map((o) => ({ ...o, label: t(o.label) })),
  };
}

export function toClientResource(res: ResourceDef, t: TFunction = createT(null)): ClientResource {
  return plain({
    name: res.name,
    singular: res.singular,
    label: t(res.label),
    labelPlural: t(res.labelPlural),
    description: t(res.description),
    icon: res.icon,
    area: res.area,
    fields: res.fields.map((f) => translateField(f, t)),
    children: (res.children ?? []).map((c) => ({ ...c, label: t(c.label), fields: c.fields.map((f) => translateField(f, t)) })),
    actions: (res.actions ?? []).map(({ name, label, description, icon, variant, confirm, input }) => ({
      name,
      label: t(label),
      description: t(description),
      icon,
      variant,
      confirm: confirm && t(confirm),
      input: input?.map((f) => translateField(f, t)),
    })),
    related: (res.related ?? []).map((r) => ({ ...r, label: t(r.label) })),
    statusField: res.statusField,
    view: res.view ?? "default",
    softDelete: !!res.softDelete,
    readOnly: !!res.readOnly,
    noCreate: !!res.noCreate,
    noDelete: !!res.noDelete,
  });
}


export function optionFor(field: FieldDef | undefined, value: unknown) {
  return field?.options?.find((o) => o.value === value);
}

export type Labels = Record<string, Record<string, string>>;

export interface ListRowData {
  id: number;
  values: Row;
}
