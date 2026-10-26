import { z } from "zod";
import { isValidIban } from "@batzio/core/swiss/iban";
import type { ChildDef, FieldDef, ResourceDef, Row } from "./types";

export type SchemaMode = "create" | "update" | "output";

const NUMERIC = new Set(["int", "decimal", "money", "percent", "ref"]);

/** Base (non-optional) zod type for a field in API representation. */
export function fieldSchema(field: FieldDef): z.ZodType {
  let s: z.ZodType;
  switch (field.type) {
    case "email":
      s = z.email();
      break;
    case "iban":
      s = z.string().refine((v) => isValidIban(v), "Invalid IBAN");
      break;
    case "int":
    case "ref": {
      let n = z.number().int();
      if (field.min !== undefined) n = n.min(field.min);
      if (field.max !== undefined) n = n.max(field.max);
      s = n;
      break;
    }
    case "decimal":
    case "money":
    case "percent": {
      let n = z.number();
      if (field.min !== undefined) n = n.min(field.min);
      if (field.max !== undefined) n = n.max(field.max);
      s = n;
      break;
    }
    case "date":
      s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
      break;
    case "time":
      s = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "enum":
      s = z.enum((field.options ?? []).map((o) => o.value) as [string, ...string[]]);
      break;
    case "tags":
      s = z.array(z.number().int());
      break;
    case "json":
      s = z.unknown();
      break;
    default: {
      let str = z.string();
      if (field.maxLength) str = str.max(field.maxLength);
      s = str;
    }
  }
  const description = [field.description ?? field.label, field.type === "money" ? "(amount in major units, e.g. 1250.50)" : ""]
    .filter(Boolean)
    .join(" ");
  return s.describe(description);
}

function isWritable(field: FieldDef, mode: SchemaMode): boolean {
  if (mode === "output") return true;
  if (field.readOnly) return false;
  if (mode === "update" && field.createOnly) return false;
  return true;
}

function objectFor(fields: FieldDef[], mode: SchemaMode, scope?: Record<string, unknown>) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    if (!isWritable(field, mode) || (scope && field.name in scope && mode !== "output")) continue;
    const base = fieldSchema(field);
    const required = mode === "create" && field.required && field.default === undefined;
    shape[field.name] = required ? base : base.nullable().optional();
  }
  return shape;
}

function childSchema(child: ChildDef, mode: SchemaMode) {
  const shape = objectFor(child.fields, mode === "output" ? "output" : "create");
  // An existing row's id keeps its identity when the collection is rewritten.
  if (mode !== "output" && child.fields.some((f) => f.name === "id")) {
    shape.id = z.number().int().positive().nullable().optional().describe("Id of an existing row to keep");
  }
  return z.array(z.object(shape)).describe(child.label);
}

/** Zod schema for API input/output of a resource. */
export function resourceSchema(resource: ResourceDef, mode: SchemaMode) {
  const shape = objectFor(resource.fields, mode, resource.scope);
  for (const child of resource.children ?? []) {
    shape[child.name] = mode === "output" ? childSchema(child, mode) : childSchema(child, mode).optional();
  }
  return mode === "output" ? z.object(shape) : z.object(shape).strip();
}

/**
 * Normalises loosely typed input (form posts, query strings, LLM tool calls):
 * empty strings become null, numeric strings become numbers, "true"/"false"
 * become booleans.
 */
export function coerceInput(fields: FieldDef[], input: Row): Row {
  const out: Row = {};
  const byName = new Map(fields.map((f) => [f.name, f]));
  for (const [key, raw] of Object.entries(input)) {
    const field = byName.get(key);
    if (!field) {
      out[key] = raw;
      continue;
    }
    let v: unknown = raw;
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "" && field.type !== "json") v = null;
      else if (NUMERIC.has(field.type)) {
        const n = Number(t.replace(/['’\s]/g, "").replace(",", "."));
        v = Number.isFinite(n) ? n : t;
      } else if (field.type === "boolean") v = t === "true" || t === "1" || t === "on";
      else if (field.type === "iban") v = t.replace(/\s+/g, "").toUpperCase();
      else if (field.type === "tags") v = t.split(",").map((x) => Number(x.trim())).filter(Number.isFinite);
      else v = field.type === "text" ? v : t;
    } else if (field.type === "boolean" && typeof v === "number") {
      v = v !== 0;
    }
    out[key] = v;
  }
  return out;
}

export interface ValidationFailure {
  /** English template, see AppError. */
  message: string;
  fields: Record<string, string>;
  vars?: Record<string, string>;
}

export function formatZodError(error: z.ZodError, labels: Record<string, string> = {}): ValidationFailure {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    const missing = issue.code === "invalid_type" && (issue as { input?: unknown }).input === undefined;
    if (!fields[key]) fields[key] = missing ? "Required" : issue.message;
  }
  const first = Object.entries(fields)[0];
  if (!first) return { message: "Invalid input", fields };
  const field = labels[first[0]] ?? first[0];
  return first[1] === "Required"
    ? { message: "{field} is required.", fields, vars: { field } }
    : { message: "{field}: {problem}", fields, vars: { field, problem: first[1] } };
}
