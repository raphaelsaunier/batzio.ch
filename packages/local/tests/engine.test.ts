import { describe, expect, it } from "vitest";
import { createEngine, multipart } from "./helpers/node-host";

/**
 * The on-device engine as the apps use it: the bundled script, a host bridge
 * and SQLite. "bare" is an empty V8 context (no web platform at all, like
 * JavaScriptCore on Apple devices and ClearScript on Windows); "web" is a
 * full web platform (like Android's WebView).
 */
for (const bare of [true, false]) {
  describe(bare ? "on-device engine in a bare JavaScript engine" : "on-device engine in a web view", () => {
    const engine = createEngine({ bare });
    let token = "";
    let tenant = "";

    it("creates a local account and company with demo data", async () => {
      const res = await engine.request("POST", "/api/v1/auth/signup", {
        json: { name: "Anna Muster", email: "anna@device.local", password: "on-this-device-only", company: "Muster GmbH", language: "de", demo: true },
      });
      expect(res.status, res.bytes.toString()).toBe(200);
      const data = res.json().data;
      token = data.token;
      tenant = data.companies[0].slug;
      expect(token).toBeTruthy();
      expect(tenant).toBe("muster-gmbh");
      // JavaScriptCore and ClearScript read the answer as soon as dispatch returns.
      if (bare) expect(res.settledSynchronously).toBe(true);
    });

    it("signs in again with the stored password", async () => {
      const res = await engine.request("POST", "/api/v1/auth/login", { json: { email: "anna@device.local", password: "on-this-device-only" } });
      expect(res.status).toBe(200);
      const wrong = await engine.request("POST", "/api/v1/auth/login", { json: { email: "anna@device.local", password: "nope-nope-nope" } });
      expect(wrong.status).toBe(401);
    });

    it("serves the bootstrap, Today and lists in the caller's language", async () => {
      const boot = await engine.request("GET", `/api/v1/app/bootstrap?mode=simple&locale=de`, { token, tenant, locale: "de" });
      expect(boot.status).toBe(200);
      expect(boot.json().data.navigation[0].items[0].title).toBe("Heute");
      const today = await engine.request("GET", "/api/v1/app/today", { token, tenant });
      expect(today.status).toBe(200);
      const list = await engine.request("GET", "/api/v1/app/records/invoices?limit=5", { token, tenant });
      expect(list.json().data.rows.length).toBeGreaterThan(0);
    });

    it("formats Swiss amounts and dates like the server", async () => {
      const report = await engine.request("GET", "/api/v1/app/reports/vat", { token, tenant, locale: "de" });
      expect(report.status).toBe(200);
      expect(report.json().data.subtitle).toMatch(/^\d{2}\.\d{2}\.\d{4} – \d{2}\.\d{2}\.\d{4}$/);
      const today = await engine.request("GET", "/api/v1/app/today", { token, tenant, locale: "de" });
      expect(today.bytes.toString("utf8")).toMatch(/CHF \d['’]\d{3}\.\d{2}/);
    });

    it("creates, issues and prints an invoice with a QR-bill", async () => {
      const contacts = await engine.request("GET", "/api/v1/contacts?limit=1", { token, tenant });
      const contactId = contacts.json().data[0].id;
      const created = await engine.request("POST", "/api/v1/invoices", {
        token,
        tenant,
        json: { contact_id: contactId, positions: [{ type: "custom", text: "Workshop", quantity: 2, unit_price: 50 }] },
      });
      expect(created.status, created.bytes.toString()).toBe(201);
      const invoice = created.json().data;
      expect(invoice.total).toBe(108.1);
      const issued = await engine.request("POST", `/api/v1/invoices/${invoice.id}/issue`, { token, tenant, json: {} });
      expect(issued.status, issued.bytes.toString()).toBe(200);
      expect(issued.json().data.record.status).toBe("open");
      const pdf = await engine.request("GET", `/api/v1/invoices/${invoice.id}/pdf`, { token, tenant });
      expect(pdf.status).toBe(200);
      expect(pdf.header("content-type")).toBe("application/pdf");
      expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.bytes.length).toBeGreaterThan(10_000);
    });

    it("stores uploads in the app's folder and serves them back", async () => {
      const form = multipart([{ name: "file", filename: "Quittung Café.txt", type: "text/plain", data: "Kaffee 4.50 CHF – merci" }]);
      const up = await engine.request("POST", "/api/v1/files/upload", { token, tenant, body: form.body, contentType: form.contentType });
      expect(up.status, up.bytes.toString()).toBe(200);
      const file = up.json().data;
      expect(file.name).toBe("Quittung Café.txt");
      expect(engine.files.size).toBeGreaterThan(0);
      const down = await engine.request("GET", `/api/v1/files/${file.id}/download`, { token, tenant });
      expect(down.bytes.toString("utf8")).toBe("Kaffee 4.50 CHF – merci");
      expect(down.header("content-disposition")).toBe(`attachment; filename="Quittung Cafe.txt"; filename*=UTF-8''Quittung%20Caf%C3%A9.txt`);
    });

    it("reads uploads the way .NET writes them (bare names, filename*)", async () => {
      const boundary = "dotnet-boundary";
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: text/plain\r\nContent-Disposition: form-data; name=file; filename=Beleg.txt; filename*=utf-8''Beleg%20M%C3%BCller.txt\r\n\r\n`),
        Buffer.from("Müller AG"),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const up = await engine.request("POST", "/api/v1/files/upload", { token, tenant, body: new Uint8Array(body), contentType: `multipart/form-data; boundary="${boundary}"` });
      expect(up.status, up.bytes.toString()).toBe(200);
      expect(up.json().data.name).toBe("Beleg Müller.txt");
    });

    it("runs quick sentences and imports drops without the network", async () => {
      const plan = await engine.request("POST", "/api/v1/app/quick/plan", { token, tenant, json: { text: "paid 42.50 for train tickets yesterday" } });
      expect(plan.status).toBe(200);
      const run = await engine.request("POST", "/api/v1/app/quick/run", { token, tenant, json: { text: "paid 42.50 for train tickets yesterday", actionId: plan.json().data.actions[0].id } });
      expect(run.status, run.bytes.toString()).toBe(200);
      const csv = multipart([{ name: "files", filename: "kunden.csv", type: "text/csv", data: "Name;Ort\nBergsicht Hotels AG;Zermatt\n" }]);
      const drop = await engine.request("POST", "/api/drop", { token, tenant, body: csv.body, contentType: csv.contentType });
      expect(drop.status, drop.bytes.toString()).toBe(200);
      expect(drop.json().agent).toBe(false);
    });

    it("answers a retried request once (Idempotency-Key)", async () => {
      const key = `retry-${bare ? "bare" : "web"}`;
      const send = () => engine.request("POST", "/api/v1/contacts", { token, tenant, json: { type: "company", name_1: "Retry Test AG" }, headers: [["idempotency-key", key]] });
      const first = await send();
      const again = await send();
      expect(first.status, first.bytes.toString()).toBe(201);
      expect(again.status).toBe(201);
      expect(again.header("idempotent-replayed")).toBe("true");
      expect(again.json().data.id).toBe(first.json().data.id);
      const list = await engine.request("GET", "/api/v1/contacts?name_1=Retry%20Test%20AG", { token, tenant });
      expect(list.json().data).toHaveLength(1);
      const misuse = await engine.request("POST", "/api/v1/projects", { token, tenant, json: { name: "x" }, headers: [["idempotency-key", key]] });
      expect(misuse.status).toBe(422);
    });

    it("keeps the history of every change, with provenance and undo", async () => {
      const created = await engine.request("POST", "/api/v1/contacts", { token, tenant, json: { type: "company", name_1: "Undo Test AG" } });
      const id = created.json().data.id;
      await engine.request("PATCH", `/api/v1/contacts/${id}`, { token, tenant, json: { name_1: "Undo Test GmbH" } });
      const history = await engine.request("GET", `/api/v1/app/history/contacts/${id}`, { token, tenant, locale: "de" });
      const [change] = history.json().data;
      expect(change).toMatchObject({ action: "update", undo: { possible: true } });
      expect(change.changes[0]).toMatchObject({ kind: "changed", from: "Undo Test AG", to: "Undo Test GmbH" });
      const undo = await engine.request("POST", `/api/v1/audit_log/${change.id}/undo`, { token, tenant, json: {} });
      expect(undo.status, undo.bytes.toString()).toBe(200);
      const back = await engine.request("GET", `/api/v1/contacts/${id}`, { token, tenant });
      expect(back.json().data.name_1).toBe("Undo Test AG");
    });

    it("explains that Batzi needs a connection", async () => {
      const res = await engine.request("POST", "/api/agent", { token, tenant, json: { text: "Hello" } });
      expect(res.status).toBe(200);
      const events = res.bytes.toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(events.at(-1)).toEqual({ type: "error", message: "no_agent" });
    });

    it("answers unknown paths and bad tokens like the server", async () => {
      expect((await engine.request("GET", "/api/mcp")).status).toBe(404);
      expect((await engine.request("GET", "/api/v1/app/bootstrap", { token: "nope", tenant })).status).toBe(401);
    });

    it("keeps each company in its own database", () => {
      expect([...engine.dbs.keys()].sort()).toEqual(["DB", "TENANT_DB_001"]);
    });
  });
}

describe("on-device engine without native crypto", () => {
  it("hashes passwords with the JavaScript PBKDF2", async () => {
    const engine = createEngine({ bare: true, nativeCrypto: false });
    const res = await engine.request("POST", "/api/v1/auth/signup", { json: { name: "A", email: "a@device.local", password: "on-this-device-only", company: "A AG", language: "en", demo: false } });
    expect(res.status, res.bytes.toString()).toBe(200);
    const login = await engine.request("POST", "/api/v1/auth/login", { json: { email: "a@device.local", password: "on-this-device-only" } });
    expect(login.status).toBe(200);
  }, 120_000);
});
