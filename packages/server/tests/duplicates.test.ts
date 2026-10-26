import { describe, expect, it } from "vitest";
import { dropFiles } from "../src/agent/inbox";
import type { AuditRow } from "../src/audit";
import { createRecord, getRecord, listRecords, runAction } from "../src/crud";
import type { Ctx } from "../src/ctx";
import { normalizeName, scanDuplicates } from "../src/duplicates";
import { storeFile } from "../src/files";
import { getNudges } from "../src/nudges";
import { getResource } from "../src/resources/registry";
import { makeCtx } from "./helpers/tenant";

const contacts = getResource("contacts")!;
const bills = getResource("bills")!;
const invoices = getResource("invoices")!;
const duplicates = getResource("duplicates")!;

const open = (ctx: Ctx) => ctx.db.all<{ id: number; resource: string; record_id: number; original_id: number; reason: string }>("SELECT * FROM duplicates WHERE status = 'open' ORDER BY id");
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("duplicates", () => {
  it("treats legal forms, case and accents as the same name", () => {
    expect(normalizeName("Bergsicht Hotels AG")).toBe(normalizeName("BERGSICHT-HOTELS ag."));
    expect(normalizeName("Atelier Morel Sàrl")).toBe(normalizeName("atelier morel"));
    expect(normalizeName("Müller", "Anna")).toBe(normalizeName("Muller", "Anna"));
  });

  it("flags a contact created twice and lets a person merge it", async () => {
    const ctx = await makeCtx();
    const original = await createRecord(ctx, contacts, { type: "company", name_1: "Bergsicht Hotels AG", email: "info@bergsicht.ch" });
    const copy = await createRecord(ctx, contacts, { type: "company", name_1: "BERGSICHT-HOTELS ag.", email: "INFO@bergsicht.ch" });
    const [flag] = await open(ctx);
    expect(flag).toMatchObject({ resource: "contacts", record_id: copy.id, original_id: original.id, reason: "same_email" });

    const invoice = await createRecord(ctx, invoices, { contact_id: copy.id, positions: [{ type: "custom", text: "Workshop", quantity: 1, unit_price: 100 }] });
    await runAction(ctx, duplicates, flag.id, "merge");
    expect((await getRecord(ctx, invoices, Number(invoice.id))).contact_id).toBe(original.id);
    expect((await getRecord(ctx, contacts, Number(copy.id), false)).archived_at).toBeTruthy();
    expect(await open(ctx)).toEqual([]);
    const merged = await ctx.db.first<AuditRow>("SELECT * FROM audit_log WHERE action = 'merge'");
    expect(merged?.resource_id).toBe(String(original.id));
  });

  it("flags a supplier bill entered twice and removes the copy", async () => {
    const ctx = await makeCtx();
    const supplier = await createRecord(ctx, contacts, { type: "company", name_1: "Swisscom AG", is_supplier: true });
    const bill = { contact_id: supplier.id, vendor_nr: "R-2026-1001", date: "2026-10-01", lines: [{ text: "Internet", amount: 89.9 }] };
    const first = await createRecord(ctx, bills, bill);
    const second = await createRecord(ctx, bills, { ...bill, vendor_nr: "r 2026 1001" });
    const [flag] = await open(ctx);
    expect(flag).toMatchObject({ resource: "bills", record_id: second.id, original_id: first.id, reason: "same_supplier_number" });
    await runAction(ctx, duplicates, flag.id, "remove_copy");
    await expect(getRecord(ctx, bills, Number(second.id))).rejects.toThrow();
    expect((await getRecord(ctx, bills, Number(first.id))).id).toBe(first.id);
  });

  it("can be dismissed for records that only look alike", async () => {
    const ctx = await makeCtx();
    await createRecord(ctx, contacts, { type: "person", name_1: "Meier", name_2: "Hans" });
    await createRecord(ctx, contacts, { type: "person", name_1: "Meier", name_2: "Hans" });
    const [flag] = await open(ctx);
    expect(flag.reason).toBe("same_name");
    await runAction(ctx, duplicates, flag.id, "dismiss");
    expect(await open(ctx)).toEqual([]);
  });

  it("recognises the same file and never books a dropped receipt twice", async () => {
    const ctx = await makeCtx();
    const a = await storeFile(ctx, { name: "scan.pdf", type: "application/pdf", bytes: bytes("%PDF-1.7 receipt 42.50") });
    const b = await storeFile(ctx, { name: "scan (1).pdf", type: "application/pdf", bytes: bytes("%PDF-1.7 receipt 42.50") });
    expect(a.sha256).toBe(b.sha256);
    expect((await open(ctx)).map((d) => d.reason)).toEqual(["same_file"]);

    const [again] = await dropFiles(ctx, [{ name: "receipt.pdf", type: "application/pdf", bytes: bytes("%PDF-1.7 receipt 42.50") }]);
    expect(again).toMatchObject({ handled: true, kind: "duplicate", file: { id: a.id } });
    const files = await listRecords(ctx, getResource("files")!, { limit: 10 });
    expect(files.total).toBe(2);
  });

  it("shows up on Today and is found again by a scan", async () => {
    const ctx = await makeCtx();
    // Written behind the engine's back (as an old import would have), so only the scan sees it.
    await ctx.db.run("INSERT INTO contacts (type, name_1, email) VALUES ('company', 'Rhein Logistik AG', 'ap@rhein.ch'), ('company', 'Rhein Logistik', 'ap@rhein.ch')");
    expect(await scanDuplicates(ctx)).toBe(1);
    expect(await scanDuplicates(ctx)).toBe(0);
    const nudges = await getNudges(ctx, "/test", "en");
    expect(nudges.map((n) => n.key)).toContain("duplicates");
  });
});
