import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { toolkit } from "@/lib/agent/toolkit";
import { FAMILIES, FRIENDLY, STATUS } from "@/lib/friendly";
import { buildNavigation } from "@/lib/navigation";
import { AREA_LABELS, ROLE_LABELS, ROLES } from "@/lib/permissions";
import { listResources } from "@/lib/resources/registry";
import type { FieldDef } from "@/lib/resources/types";
import { DEFAULT_SEQUENCES } from "@/lib/server/numbering";

const ROOT = join(__dirname, "..", "..");
const DIRS = ["app", "components", "lib"];
const SKIP = [/components\/ui\//, /lib\/i18n\/messages\//, /lib\/server\/pdf\//, /lib\/i18n\/glossary\.ts$/];
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;

const PATTERNS = [
  new RegExp(String.raw`\bt\(\s*${STR}`, "g"),
  new RegExp(String.raw`\bN_\(\s*${STR}`, "g"),
  new RegExp(String.raw`\bmsg\(\s*${STR}`, "g"),
  new RegExp(String.raw`new AppError\(\s*"[a-z_]+",\s*${STR}`, "g"),
  new RegExp(String.raw`\(await getT\(\)\)\(\s*${STR}`, "g"),
  new RegExp(String.raw`<Line[^>]*?\blabel=${STR}`, "g"),
  // t(cond ? "a" : "b") — both branches.
  new RegExp(String.raw`\bt\([^()"\n]*?\?\s*${STR}`, "g"),
  new RegExp(String.raw`\bt\([^()"\n]*?\?\s*"(?:[^"\\]|\\.)*"\s*:\s*${STR}`, "g"),
  // Field definitions and options written in page files.
  new RegExp(String.raw`\bf\.\w+\(\s*"\w+",\s*${STR}`, "g"),
  new RegExp(String.raw`\bopt\(\s*"[^"]*",\s*${STR}`, "g"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const unescape = (s: string) => JSON.parse(`"${s}"`) as string;

/** Literal strings handed to the translator anywhere in the source. */
export function sourceKeys(): Set<string> {
  const keys = new Set<string>();
  for (const dir of DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = file.slice(ROOT.length + 1);
      if (SKIP.some((re) => re.test(rel))) continue;
      const text = readFileSync(file, "utf8");
      for (const re of PATTERNS) for (const m of text.matchAll(re)) keys.add(unescape(m[1]));
      // Action results in resource definitions: every string on a `message:` line.
      if (rel.startsWith("lib/resources/defs/")) {
        for (const line of text.split("\n")) {
          if (/\bmessage:|lockReason|confirm:/.test(line)) for (const m of line.matchAll(new RegExp(STR, "g"))) if (/[a-z]{3}/.test(m[1]) && /\s/.test(m[1])) keys.add(unescape(m[1]));
        }
      }
      // Lock reasons computed in server modules.
      for (const fn of text.matchAll(/function \w*LockReason[^{]*\{([\s\S]*?)\n\}/g)) for (const m of fn[1].matchAll(new RegExp(STR, "g"))) if (/\s/.test(m[1])) keys.add(unescape(m[1]));
    }
  }
  return keys;
}

function fieldKeys(fields: FieldDef[], keys: Set<string>) {
  for (const f of fields) {
    keys.add(f.label);
    if (f.description) keys.add(f.description);
    if (f.placeholder) keys.add(f.placeholder);
    if (f.section) keys.add(f.section);
    for (const o of f.options ?? []) keys.add(o.label);
  }
}

/** Strings that live in data structures (resource definitions, navigation, …). */
export function runtimeKeys(): Set<string> {
  const keys = new Set<string>();
  for (const r of listResources()) {
    keys.add(r.label);
    keys.add(r.labelPlural);
    keys.add(r.description);
    fieldKeys(r.fields, keys);
    for (const c of r.children ?? []) {
      keys.add(c.label);
      fieldKeys(c.fields, keys);
    }
    for (const a of r.actions ?? []) {
      keys.add(a.label);
      keys.add(a.description);
      if (a.confirm) keys.add(a.confirm);
      fieldKeys(a.input ?? [], keys);
    }
    for (const rel of r.related ?? []) keys.add(rel.label);
  }
  for (const copy of Object.values(FRIENDLY)) {
    for (const v of [copy.label, copy.labelPlural, copy.description, copy.empty?.title, copy.empty?.text]) if (v) keys.add(v);
  }
  for (const map of Object.values(STATUS)) for (const v of Object.values(map)) keys.add(v);
  for (const f of FAMILIES) {
    keys.add(f.title);
    for (const e of f.extras ?? []) keys.add(e.title);
  }
  for (const role of ROLES) {
    for (const mode of ["simple", "accountant"] as const) {
      for (const section of buildNavigation("x", role, mode)) {
        if (section.label) keys.add(section.label);
        for (const item of section.items) keys.add(item.title);
      }
    }
  }
  for (const v of Object.values(ROLE_LABELS)) keys.add(v);
  for (const v of Object.values(AREA_LABELS)) keys.add(v);
  for (const s of DEFAULT_SEQUENCES) keys.add(s.label);
  for (const tool of toolkit()) keys.add(tool.title);
  keys.delete("");
  return keys;
}
