import { describe, expect, it } from "vitest";
import { tFor } from "@batzio/i18n/server";
import { verifyAuditLog, type AuditRow } from "../src/audit";
import { createRecord, deleteRecord, getRecord, runAction, updateRecord } from "../src/crud";
import { withProvenance, type Ctx } from "../src/ctx";
import { describeDevice, recordHistory, undoChange } from "../src/history";
import { getResource } from "../src/resources/registry";
import { makeCtx } from "./helpers/tenant";

const contacts = getResource("contacts")!;
const invoices = getResource("invoices")!;
const de = tFor("de");

const last = (ctx: Ctx) => ctx.db.first<AuditRow>("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1") as Promise<AuditRow>;
const asAgent = (ctx: Ctx, context: Record<string, string>) => withProvenance({ ...ctx, actor: { ...ctx.actor, source: "agent" } }, context);

async function invoiceWithPositions(ctx: Ctx) {
  const customer = await createRecord(ctx, contacts, { type: "company", name_1: "Bergsicht Hotels AG" });
  const invoice = await createRecord(ctx, invoices, {
    contact_id: customer.id,
    title: "Workshop",
    positions: [
      { type: "custom", text: "Workshop", quantity: 2, unit_price: 50 },
      { type: "custom", text: "Travel", quantity: 1, unit_price: 30 },
    ],
  });
  return { customer, invoice: await getRecord(ctx, invoices, Number(invoice.id)) };
}

describe("audit provenance", () => {
  it("records where a change came from and seals it into the chain", async () => {
    const ctx = await makeCtx();
    await createRecord(asAgent(ctx, { thread: "th_1", tool: "create_contact" }), contacts, { type: "company", name_1: "Bergsicht Hotels AG" });
    const row = await last(ctx);
    expect(row.hash_version).toBe(2);
    expect(JSON.parse(row.context!)).toMatchObject({ thread: "th_1", tool: "create_contact" });
    expect((await verifyAuditLog(ctx)).ok).toBe(true);

    await ctx.db.run("UPDATE audit_log SET context = ? WHERE id = ?", JSON.stringify({ thread: "forged" }), row.id);
    expect(await verifyAuditLog(ctx)).toMatchObject({ ok: false, brokenAt: row.id });
  });

  it("keeps the IP address and device outside the chain, so they can be erased", async () => {
    const ctx = await makeCtx();
    const visitor = { ...ctx, actor: { ...ctx.actor, ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15" } };
    await createRecord(visitor, contacts, { type: "person", name_1: "Morel", name_2: "Claire" });
    const row = await last(ctx);
    expect(row.ip).toBe("203.0.113.7");
    await ctx.db.run("UPDATE audit_log SET ip = NULL, user_agent = NULL");
    expect((await verifyAuditLog(ctx)).ok).toBe(true);
  });

  it("tells people from software and names the source", async () => {
    const ctx = await makeCtx();
    const { customer } = await invoiceWithPositions(ctx);
    await updateRecord(asAgent(ctx, { thread: "th_9", tool: "update_contact" }), contacts, Number(customer.id), { email: "info@bergsicht.ch" });
    const [byBatzi, byPerson] = await recordHistory(ctx, de, "contacts", Number(customer.id));
    expect(byBatzi.actor).toMatchObject({ automated: true, source: "agent", sourceLabel: "Batzi" });
    expect(byBatzi.provenance).toEqual([{ label: expect.any(String), detail: "update contact" }]);
    expect(byPerson.actor).toMatchObject({ automated: false, source: "ui" });
  });

  it("recognises browsers, the apps and scripts", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 Edg/142.0")).toBe("Edge on Windows");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(describeDevice("Batzio-Android/0.1.0 (Android 16)")).toBe("Batzio for Android");
    expect(describeDevice("curl/8.7.1")).toBe("Script (curl)");
    expect(describeDevice(null)).toBeNull();
  });
});

describe("readable history", () => {
  it("shows changed fields and positions with labels and Swiss formatting", async () => {
    const ctx = await makeCtx();
    const { invoice } = await invoiceWithPositions(ctx);
    const [workshop, travel] = invoice.positions as { id: number }[];
    await updateRecord(ctx, invoices, Number(invoice.id), {
      title: "Workshop Zermatt",
      positions: [
        { id: workshop.id, type: "custom", text: "Workshop", quantity: 3, unit_price: 50 },
        { type: "custom", text: "Hotel", quantity: 1, unit_price: 1250 },
      ],
    });
    const [entry] = await recordHistory(ctx, de, "invoices", Number(invoice.id));
    expect(entry.title).toBe(de("Changed"));
    expect(entry.changes).toContainEqual({ field: "title", label: de("Title"), kind: "changed", from: "Workshop", to: "Workshop Zermatt" });
    const positions = entry.changes.filter((c) => c.field === "positions");
    expect(positions.find((c) => c.kind === "added")?.to).toMatch(/^Hotel \(1’250\.00|^Hotel \(1'250\.00/);
    expect(positions.find((c) => c.kind === "removed")?.from).toMatch(/^Travel/);
    expect(positions.find((c) => c.kind === "changed")?.to).toMatch(/2 → 3/);
    expect(travel.id).toBeTruthy();
    const total = entry.changes.find((c) => c.field === "total");
    expect(total?.from).toMatch(/^1[3]0\.00$|^140\.00$|^\d/);
  });
});

describe("undo", () => {
  it("puts the previous values back, once", async () => {
    const ctx = await makeCtx();
    const { customer } = await invoiceWithPositions(ctx);
    await updateRecord(ctx, contacts, Number(customer.id), { name_1: "Bergsicht Hotel AG", email: "hallo@bergsicht.ch" });
    const change = await last(ctx);
    await undoChange(ctx, change.id);
    const back = await getRecord(ctx, contacts, Number(customer.id));
    expect(back.name_1).toBe("Bergsicht Hotels AG");
    expect(back.email).toBeNull();
    const undo = await last(ctx);
    expect(undo).toMatchObject({ action: "rollback", rollback_of: change.id });
    await expect(undoChange(ctx, change.id)).rejects.toThrow(/already undone/);
    expect((await verifyAuditLog(ctx)).ok).toBe(true);
  });

  it("restores positions and totals of a draft", async () => {
    const ctx = await makeCtx();
    const { invoice } = await invoiceWithPositions(ctx);
    await updateRecord(ctx, invoices, Number(invoice.id), { positions: [{ type: "custom", text: "Only this", quantity: 1, unit_price: 10 }] });
    await undoChange(ctx, (await last(ctx)).id);
    const back = await getRecord(ctx, invoices, Number(invoice.id));
    expect((back.positions as { text: string }[]).map((p) => p.text)).toEqual(["Workshop", "Travel"]);
    expect(back.total).toBe(invoice.total);
  });

  it("refuses when the record was changed again since", async () => {
    const ctx = await makeCtx();
    const { customer } = await invoiceWithPositions(ctx);
    await updateRecord(ctx, contacts, Number(customer.id), { name_1: "First rename" });
    const first = await last(ctx);
    await updateRecord(ctx, contacts, Number(customer.id), { name_1: "Second rename" });
    await expect(undoChange(ctx, first.id)).rejects.toThrow(/changed again/);
  });

  it("never rewrites issued documents", async () => {
    const ctx = await makeCtx();
    const { invoice } = await invoiceWithPositions(ctx);
    await updateRecord(ctx, invoices, Number(invoice.id), { title: "Before issuing" });
    const edit = await last(ctx);
    await runAction(ctx, invoices, Number(invoice.id), "issue");
    await expect(undoChange(ctx, edit.id)).rejects.toThrow();
    const [newest] = await recordHistory(ctx, de, "invoices", Number(invoice.id));
    expect(newest.undo.possible).toBe(false);
  });

  it("removes what was created and brings back what was deleted, under its old number", async () => {
    const ctx = await makeCtx();
    const { invoice } = await invoiceWithPositions(ctx);
    const created = await ctx.db.first<AuditRow>("SELECT * FROM audit_log WHERE resource = 'invoices' AND action = 'create'");
    await deleteRecord(ctx, invoices, Number(invoice.id));
    const deleted = await last(ctx);
    await undoChange(ctx, deleted.id);
    const back = await getRecord(ctx, invoices, Number(invoice.id));
    expect(back.nr).toBe(invoice.nr);
    expect((back.positions as unknown[]).length).toBe(2);
    expect(back.total).toBe(invoice.total);

    // The original creation can no longer be undone blindly: the record was deleted and brought back since.
    const entries = await recordHistory(ctx, de, "invoices", Number(invoice.id));
    expect(entries[0].action).toBe("rollback");
    expect(entries.find((e) => e.id === created!.id)?.undo.possible).toBe(false);
  });

  it("is offered to people who may write, never for steps with their own counter-action", async () => {
    const ctx = await makeCtx();
    const { invoice } = await invoiceWithPositions(ctx);
    await runAction(ctx, invoices, Number(invoice.id), "issue");
    const issued = await last(ctx);
    expect(issued.action).toBe("issue");
    await expect(undoChange(ctx, issued.id)).rejects.toThrow(/counter-action/);
    const viewer = { ...ctx, role: "viewer" as const };
    await expect(undoChange(viewer, issued.id)).rejects.toThrow();
  });
});
