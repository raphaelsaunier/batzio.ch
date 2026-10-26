#!/usr/bin/env node
/**
 * Manages the pool of per-tenant D1 database slots in packages/server/src/config/tenant-databases.ts.
 *
 *   pnpm db:slots list          show configured slots
 *   pnpm db:slots add [count]   append new slots (default 10); deploy afterwards so
 *                               `cf` provisions the databases and binds them
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../src/config/tenant-databases.ts", import.meta.url));
const source = readFileSync(file, "utf8");
const slotPattern = /\{ binding: "TENANT_DB_(\d+)", name: "([^"]+)" \}/g;
const slots = [...source.matchAll(slotPattern)].map((m) => ({ index: Number(m[1]), name: m[2] }));
const [command = "list", arg] = process.argv.slice(2);

if (command === "list") {
  console.log(`${slots.length} tenant database slot(s):`);
  for (const s of slots) console.log(`  TENANT_DB_${String(s.index).padStart(3, "0")}  →  ${s.name}`);
  process.exit(0);
}

if (command === "add") {
  const count = Math.max(1, Number(arg ?? 10) || 10);
  const start = slots.reduce((max, s) => Math.max(max, s.index), 0) + 1;
  const lines = Array.from({ length: count }, (_, i) => {
    const n = String(start + i).padStart(3, "0");
    return `  { binding: "TENANT_DB_${n}", name: "batzio-tenant-${n}" },`;
  });
  const marker = "];";
  const at = source.lastIndexOf(marker);
  if (at < 0) throw new Error("Could not find the end of tenantDatabaseSlots.");
  writeFileSync(file, `${source.slice(0, at)}${lines.join("\n")}\n${source.slice(at)}`);
  console.log(`Added ${count} slot(s) (TENANT_DB_${String(start).padStart(3, "0")} … TENANT_DB_${String(start + count - 1).padStart(3, "0")}).`);
  console.log("Deploy to provision and bind the new databases: pnpm deploy");
  process.exit(0);
}

console.error(`Unknown command "${command}". Use "list" or "add [count]".`);
process.exit(1);
