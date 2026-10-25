import { describe, expect, it } from "vitest";
import { listResources } from "@/lib/resources/registry";
import { makeCtx } from "./helpers/tenant";

describe("resource definitions", () => {
  it("map onto existing tables and columns", async () => {
    const ctx = await makeCtx({ seed: false });
    const columns = async (table: string) =>
      new Set((await ctx.db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name));
    for (const res of listResources()) {
      const cols = await columns(res.table);
      expect(cols.size, `table ${res.table}`).toBeGreaterThan(0);
      for (const field of res.fields) expect(cols.has(field.name), `${res.name}.${field.name}`).toBe(true);
      for (const child of res.children ?? []) {
        const childCols = await columns(child.table);
        expect(childCols.has(child.foreignKey), `${child.table}.${child.foreignKey}`).toBe(true);
        for (const field of child.fields) expect(childCols.has(field.name), `${child.table}.${field.name}`).toBe(true);
      }
      for (const field of res.fields.filter((f) => f.type === "ref" || f.type === "tags")) {
        expect(listResources().some((r) => r.name === field.ref), `${res.name}.${field.name} → ${field.ref}`).toBe(true);
      }
      await ctx.db.all(`SELECT (${res.titleSql}) AS label FROM ${res.table} LIMIT 1`);
    }
  });
});
