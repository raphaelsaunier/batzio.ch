import { idField, stampFields } from "./fields";
import type { ResourceDef } from "./types";

/** Adds the id and bookkeeping columns every table carries. */
export function defineResource(def: ResourceDef, options: { stamps?: boolean } = {}): ResourceDef {
  const own = def.fields.filter((f) => f.name !== "id");
  const names = new Set(own.map((f) => f.name));
  const stamps = options.stamps === false ? [] : stampFields.filter((f) => !names.has(f.name));
  return { ...def, fields: [idField, ...own, ...stamps] };
}
