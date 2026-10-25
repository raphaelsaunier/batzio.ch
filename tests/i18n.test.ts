import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createT, interpolate } from "@/lib/i18n";
import { CATALOG } from "@/lib/i18n/messages/catalog";
import { MESSAGES } from "@/lib/i18n/messages";
import { GLOSSARY, termFor } from "@/lib/i18n/glossary";
import { balanceSheet, incomeStatement } from "@/lib/server/accounting";
import { seedDemo } from "@/lib/server/seed";
import { makeCtx } from "./helpers/tenant";
import { runtimeKeys, sourceKeys } from "./helpers/i18n-keys";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

let keys: Set<string>;

beforeAll(async () => {
  keys = new Set([...sourceKeys(), ...runtimeKeys()]);
  // Labels the report engine produces (sections, subtotals, results).
  const ctx = await makeCtx();
  await seedDemo(ctx);
  const year = new Date().getUTCFullYear();
  for (const report of [await balanceSheet(ctx, `${year}-12-31`), await incomeStatement(ctx, `${year}-01-01`, `${year}-12-31`)]) {
    for (const s of report.sections) {
      keys.add(s.title);
      for (const l of s.lines) if (l.kind === "total" || l.kind === "result") keys.add(l.label);
    }
    if (report.result) keys.add(report.result.label);
  }
});

describe("translations", () => {
  it("cover every UI string in DE, FR and IT", () => {
    const catalog = new Set(CATALOG.map((r) => r[0]));
    const missing = [...keys].filter((k) => !catalog.has(k) && /[A-Za-z]{2}/.test(k)).sort();
    if (process.env.I18N_DUMP) writeFileSync(process.env.I18N_DUMP, JSON.stringify(missing, null, 1));
    expect(missing).toEqual([]);
  });

  it("has no duplicates, gaps or broken placeholders", () => {
    const seen = new Set<string>();
    for (const row of CATALOG) {
      expect(seen.has(row[0]), `duplicate: ${row[0]}`).toBe(false);
      seen.add(row[0]);
      for (const tr of row.slice(1)) {
        expect(tr.trim(), `empty translation for ${row[0]}`).not.toBe("");
        expect(placeholders(tr), `placeholders in “${tr}”`).toBe(placeholders(row[0]));
      }
    }
  });

  it("translates and interpolates", () => {
    const t = createT(MESSAGES.de);
    expect(t("Unsaved changes")).not.toBe("Unsaved changes");
    expect(interpolate("{n} records", { n: 3 })).toBe("3 records");
    expect(createT(MESSAGES.fr)("never seen before")).toBe("never seen before");
  });

  it("explains jargon in four languages", () => {
    expect(termFor("Debit")).toBe("debit");
    expect(termFor("Input VAT")).toBe("input_tax");
    for (const entry of Object.values(GLOSSARY)) for (const l of ["en", "de", "fr", "it"] as const) expect(entry[l][1].length).toBeGreaterThan(20);
  });
});
