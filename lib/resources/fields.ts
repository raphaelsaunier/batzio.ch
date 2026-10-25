import type { FieldDef, FieldOption, FieldType, Tone } from "./types";

type Opts = Partial<Omit<FieldDef, "name" | "label" | "type">>;

const make =
  (type: FieldType) =>
  (name: string, label: string, opts: Opts = {}): FieldDef => ({ name, label, type, ...opts });

/** Concise field constructors for resource definitions. */
export const f = {
  string: make("string"),
  text: make("text"),
  email: make("email"),
  url: make("url"),
  phone: make("phone"),
  int: make("int"),
  decimal: make("decimal"),
  money: make("money"),
  percent: make("percent"),
  date: make("date"),
  datetime: make("datetime"),
  time: make("time"),
  boolean: make("boolean"),
  json: make("json"),
  iban: make("iban"),
  color: make("color"),
  enum: (name: string, label: string, options: FieldOption[], opts: Opts = {}): FieldDef => ({
    name,
    label,
    type: "enum",
    options,
    ...opts,
  }),
  ref: (name: string, label: string, ref: string, opts: Opts = {}): FieldDef => ({
    name,
    label,
    type: "ref",
    ref,
    ...opts,
  }),
  tags: (name: string, label: string, ref: string, opts: Opts = {}): FieldDef => ({
    name,
    label,
    type: "tags",
    ref,
    ...opts,
  }),
};

export const opt = (value: string, label: string, tone?: Tone): FieldOption => ({ value, label, tone });

export const LANGUAGE_OPTIONS = [opt("de", "German"), opt("fr", "French"), opt("it", "Italian"), opt("en", "English")];

export const CURRENCY_OPTIONS = [opt("CHF", "CHF"), opt("EUR", "EUR"), opt("USD", "USD"), opt("GBP", "GBP")];

export const VAT_MODE_OPTIONS = [
  opt("excl", "Prices exclude VAT"),
  opt("incl", "Prices include VAT"),
  opt("none", "No VAT"),
];

/** Read-only bookkeeping columns appended to every resource. */
export const stampFields: FieldDef[] = [
  { name: "created_at", label: "Created", type: "datetime", readOnly: true, hidden: true, sortable: true },
  { name: "updated_at", label: "Updated", type: "datetime", readOnly: true, hidden: true, sortable: true },
  { name: "created_by", label: "Created by", type: "string", readOnly: true, hidden: true },
  { name: "updated_by", label: "Updated by", type: "string", readOnly: true, hidden: true },
];

export const idField: FieldDef = { name: "id", label: "ID", type: "int", readOnly: true, hidden: true, sortable: true };
