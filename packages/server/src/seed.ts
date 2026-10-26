import { addDays, today } from "@batzio/core/format";
import { getResource } from "./resources/registry";
import { ACCOUNT_GROUPS, ACCOUNTS, groupFor, localName, parentGroupFor, type Lang } from "@batzio/core/swiss/chart-of-accounts";
import { DEFAULT_TAXES } from "@batzio/core/swiss/vat";
import { postEntry } from "./accounting";
import { importStatements } from "./banking";
import { createRecord, getRecord } from "./crud";
import type { Ctx } from "./ctx";
import type { Statement } from "./db/db";
import { DEFAULT_SEQUENCES } from "./numbering";
import { finalizePayslip, runPayroll } from "./payroll";
import { bookBill, bookExpense, payBill } from "./purchases";
import { issueDocument, recordPayment, markSent } from "./sales";
import { saveSettings } from "./settings";

const COUNTRIES: [string, string][] = [
  ["CH", "Switzerland"], ["LI", "Liechtenstein"], ["DE", "Germany"], ["AT", "Austria"], ["FR", "France"],
  ["IT", "Italy"], ["NL", "Netherlands"], ["BE", "Belgium"], ["LU", "Luxembourg"], ["ES", "Spain"],
  ["PT", "Portugal"], ["GB", "United Kingdom"], ["IE", "Ireland"], ["DK", "Denmark"], ["SE", "Sweden"],
  ["NO", "Norway"], ["FI", "Finland"], ["PL", "Poland"], ["CZ", "Czechia"], ["US", "United States"],
  ["CA", "Canada"], ["CN", "China"], ["JP", "Japan"], ["IN", "India"], ["AU", "Australia"],
];

const LOCALISED: Record<Lang, { salutations: [string, string][]; units: string[]; titles: string[] }> = {
  de: {
    salutations: [["Herr", "Sehr geehrter Herr"], ["Frau", "Sehr geehrte Frau"], ["Familie", "Liebe Familie"], ["Firma", "Sehr geehrte Damen und Herren"]],
    units: ["Std.", "Tag", "Stk.", "Pauschal", "km", "kg", "m", "Monat", "Jahr"],
    titles: ["Dr.", "Prof.", "Prof. Dr.", "lic. iur.", "dipl. Ing."],
  },
  fr: {
    salutations: [["Monsieur", "Monsieur"], ["Madame", "Madame"], ["Famille", "Chère famille"], ["Entreprise", "Madame, Monsieur"]],
    units: ["h", "jour", "pce", "forfait", "km", "kg", "m", "mois", "an"],
    titles: ["Dr", "Prof.", "Prof. Dr", "lic. en droit", "ing. dipl."],
  },
  it: {
    salutations: [["Signor", "Egregio Signor"], ["Signora", "Gentile Signora"], ["Famiglia", "Cara famiglia"], ["Ditta", "Gentili Signore e Signori"]],
    units: ["ore", "giorno", "pz.", "forfait", "km", "kg", "m", "mese", "anno"],
    titles: ["Dott.", "Prof.", "Prof. Dott.", "lic. iur.", "ing. dipl."],
  },
  en: {
    salutations: [["Mr", "Dear Mr"], ["Ms", "Dear Ms"], ["Mx", "Dear Mx"], ["Company", "Dear Sir or Madam"]],
    units: ["h", "day", "pcs", "flat rate", "km", "kg", "m", "month", "year"],
    titles: ["Dr", "Prof.", "Prof. Dr", "LLM", "MSc"],
  },
};

const stamp = (ctx: Ctx) => [ctx.actor.name, ctx.actor.name];

/** Base data every new company gets: chart of accounts, VAT codes, master data, numbering. */
export async function seedTenant(ctx: Ctx, input: { name: string; language: Lang }): Promise<void> {
  const lang = input.language;
  const loc = LOCALISED[lang] ?? LOCALISED.de;
  const year = new Date().getUTCFullYear();
  const s: Statement[] = [];
  const by = stamp(ctx);

  for (const seq of DEFAULT_SEQUENCES) {
    s.push({
      sql: "INSERT OR IGNORE INTO sequences (key, format, next_value, reset, last_year) VALUES (?, ?, ?, ?, ?)",
      params: [seq.key, seq.format, seq.start ?? 1, seq.reset, year],
    });
  }
  for (const [code, name] of COUNTRIES) s.push({ sql: "INSERT INTO countries (code, name, created_by, updated_by) VALUES (?, ?, ?, ?)", params: [code, name, ...by] });
  for (const [code, name] of [["de", "Deutsch"], ["fr", "Français"], ["it", "Italiano"], ["en", "English"], ["rm", "Rumantsch"]]) {
    s.push({ sql: "INSERT INTO languages (code, name, created_by, updated_by) VALUES (?, ?, ?, ?)", params: [code, name, ...by] });
  }
  for (const [name, letter] of loc.salutations) s.push({ sql: "INSERT INTO salutations (name, letter_salutation, created_by, updated_by) VALUES (?, ?, ?, ?)", params: [name, letter, ...by] });
  for (const name of loc.titles) s.push({ sql: "INSERT INTO titles (name, created_by, updated_by) VALUES (?, ?, ?)", params: [name, ...by] });
  for (const name of loc.units) s.push({ sql: "INSERT INTO units (name, created_by, updated_by) VALUES (?, ?, ?)", params: [name, ...by] });
  for (const [name, color] of [["Key accounts", "#2f5f8f"], ["Newsletter", "#5b8bb8"], ["Partners", "#7a8796"]]) {
    s.push({ sql: "INSERT INTO contact_groups (name, color, created_by, updated_by) VALUES (?, ?, ?, ?)", params: [name, color, ...by] });
  }
  for (const name of ["IT & software", "Consulting", "Retail", "Manufacturing", "Construction", "Healthcare", "Hospitality", "Finance & insurance", "Public sector", "Non-profit"]) {
    s.push({ sql: "INSERT INTO contact_sectors (name, created_by, updated_by) VALUES (?, ?, ?)", params: [name, ...by] });
  }
  for (const name of ["Bank transfer", "QR-bill", "Cash", "Credit card", "TWINT", "Direct debit"]) {
    s.push({ sql: "INSERT INTO payment_types (name, created_by, updated_by) VALUES (?, ?, ?)", params: [name, ...by] });
  }
  for (const [name, days, dd, dp] of [
    ["30 days net", 30, null, null],
    ["10 days net", 10, null, null],
    ["30 days, 2% discount within 10 days", 30, 10, 2],
    ["Prepayment", 0, null, null],
  ] as [string, number, number | null, number | null][]) {
    s.push({
      sql: "INSERT INTO payment_terms (name, days, discount_days, discount_percent, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)",
      params: [name, days, dd, dp, ...by],
    });
  }
  for (const [code, name, symbol, base, rate, rounding] of [
    ["CHF", "Swiss franc", "CHF", 1, 1, 0.05],
    ["EUR", "Euro", "€", 0, 0.94, 0.01],
    ["USD", "US dollar", "$", 0, 0.8, 0.01],
    ["GBP", "Pound sterling", "£", 0, 1.07, 0.01],
  ] as [string, string, string, number, number, number][]) {
    s.push({
      sql: "INSERT INTO currencies (code, name, symbol, is_base, rate, rounding, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params: [code, name, symbol, base, rate, rounding, ...by],
    });
  }

  // Chart of accounts: groups first, then accounts linked to their group.
  ACCOUNT_GROUPS.forEach((g, i) => {
    const parent = parentGroupFor(g.number);
    s.push({
      sql: `INSERT INTO account_groups (number, name, type, parent_id, sort, created_by, updated_by)
            VALUES (?, ?, ?, ${parent ? "(SELECT id FROM account_groups WHERE number = ?)" : "?"}, ?, ?, ?)`,
      params: [g.number, localName(g.names, lang), g.type, parent, i, ...by],
    });
  });
  for (const a of ACCOUNTS) {
    s.push({
      sql: `INSERT INTO accounts (number, name, type, group_id, is_system, created_by, updated_by)
            VALUES (?, ?, ?, (SELECT id FROM account_groups WHERE number = ?), ?, ?, ?)`,
      params: [a.number, localName(a.names, lang), a.type, groupFor(a.number), a.system ? 1 : 0, ...by],
    });
  }
  for (const t of DEFAULT_TAXES) {
    s.push({
      sql: `INSERT INTO taxes (code, name, rate, type, category, account_id, vat_form_digit, valid_from, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, (SELECT id FROM accounts WHERE number = ?), ?, '2024-01-01', ?, ?)`,
      params: [t.code, t.name, t.rate, t.type, t.category, t.accountNumber, t.vatFormDigit, ...by],
    });
  }
  s.push({
    sql: "INSERT INTO business_years (name, start_date, end_date, created_by, updated_by) VALUES (?, ?, ?, ?, ?)",
    params: [String(year), `${year}-01-01`, `${year}-12-31`, ...by],
  });
  for (let q = 1; q <= 4; q++) {
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const end = new Date(Date.UTC(year, endMonth, 0)).toISOString().slice(0, 10);
    s.push({
      sql: "INSERT INTO vat_periods (name, start_date, end_date, created_by, updated_by) VALUES (?, ?, ?, ?, ?)",
      params: [`Q${q} ${year}`, `${year}-${String(startMonth).padStart(2, "0")}-01`, end, ...by],
    });
  }
  s.push({
    sql: "INSERT INTO bank_accounts (name, account_id, currency_code, is_default, created_by, updated_by) VALUES (?, (SELECT id FROM accounts WHERE number = '1020'), 'CHF', 1, ?, ?)",
    params: ["Business account", ...by],
  });
  for (const [name, rate, billable] of [
    ["Consulting", 180, 1],
    ["Development", 160, 1],
    ["Project management", 170, 1],
    ["Support", 140, 1],
    ["Internal", null, 0],
  ] as [string, number | null, number][]) {
    s.push({
      sql: "INSERT INTO business_activities (name, hourly_rate, is_billable, created_by, updated_by) VALUES (?, ?, ?, ?, ?)",
      params: [name, rate, billable, ...by],
    });
  }
  s.push({ sql: "INSERT INTO stock_locations (name, created_by, updated_by) VALUES (?, ?, ?)", params: ["Main warehouse", ...by] });

  // D1 limits the number of statements per batch; chunk to be safe.
  for (let i = 0; i < s.length; i += 50) await ctx.db.batch(s.slice(i, i + 50));

  await saveSettings(ctx, "company", { name: input.name, language: lang });
  await saveSettings(ctx, "accounting", {});
  await saveSettings(ctx, "texts", {});
}

// ------------------------------------------------------------------ demo data

const id = async (ctx: Ctx, sql: string, ...params: unknown[]) => (await ctx.db.value<number>(sql, ...params))!;

/** Fills a company with realistic sample data, exercising every workflow. */
export async function seedDemo(ctx: Ctx): Promise<void> {
  const r = (name: string) => getResource(name)!;
  const t = today();
  const d = (days: number) => addDays(t, days);

  await saveSettings(ctx, "company", {
    legal_form: "GmbH",
    street: "Bahnhofstrasse",
    house_number: "10",
    postcode: "8001",
    city: "Zürich",
    country_code: "CH",
    phone: "+41 44 123 45 67",
    email: "hello@alpenblick.example",
    website: "alpenblick.example",
    vat_number: "CHE-123.456.788 MWST",
    commercial_register: "CH-020.4.123.456-7",
  });
  await ctx.db.run(
    "UPDATE bank_accounts SET name = 'ZKB Business', bank_name = 'Zürcher Kantonalbank', iban = 'CH9300762011623852957', qr_iban = 'CH4431999123000889012', bic = 'ZKBKCHZZ80A' WHERE is_default = 1",
  );

  const group = await id(ctx, "SELECT id FROM contact_groups ORDER BY id LIMIT 1");
  const term30 = await id(ctx, "SELECT id FROM payment_terms WHERE days = 30 AND discount_days IS NULL");
  const contacts = r("contacts");
  const mk = (data: Record<string, unknown>) => createRecord(ctx, contacts, data, { trusted: true });
  const bergsicht = await mk({ type: "company", name_1: "Bergsicht Hotels AG", street: "Bahnhofplatz", house_number: "4", postcode: "3920", city: "Zermatt", email: "office@bergsicht.example", phone: "+41 27 966 00 00", language: "de", group_ids: [group], payment_term_id: term30, vat_number: "CHE-109.322.551 MWST" });
  const roesterei = await mk({ type: "company", name_1: "Kaffeerösterei Lindenhof GmbH", street: "Kramgasse", house_number: "21", postcode: "3011", city: "Bern", email: "info@lindenhof.example", language: "de" });
  const rhein = await mk({ type: "company", name_1: "Rhein Logistik AG", street: "Hafenstrasse", house_number: "88", postcode: "4057", city: "Basel", email: "ap@rhein-logistik.example", language: "de", group_ids: [group] });
  const morel = await mk({ type: "company", name_1: "Atelier Morel Sàrl", street: "Rue de Bourg", house_number: "12", postcode: "1003", city: "Lausanne", email: "contact@morel.example", language: "fr" });
  const lugano = await mk({ type: "company", name_1: "Studio Lugano SA", street: "Via Nassa", house_number: "5", postcode: "6900", city: "Lugano", email: "info@studiolugano.example", language: "it" });
  const office = await mk({ type: "company", name_1: "Helvetic Office Supplies AG", street: "Technikumstrasse", house_number: "9", postcode: "8400", city: "Winterthur", is_customer: false, is_supplier: true, iban: "CH5604835012345678009", language: "de" });
  const cloud = await mk({ type: "company", name_1: "Swisscloud Hosting AG", street: "Baarerstrasse", house_number: "2", postcode: "6300", city: "Zug", is_customer: false, is_supplier: true, iban: "CH5604835012345678009", language: "de" });
  const anna = await mk({ type: "person", name_1: "Meier", name_2: "Anna", email: "anna.meier@bergsicht.example", city: "Zermatt", postcode: "3920", language: "de" });
  await mk({ type: "person", name_1: "Bernasconi", name_2: "Luca", email: "luca@studiolugano.example", city: "Lugano", postcode: "6900", language: "it" });
  await createRecord(ctx, r("contact_relations"), { contact_id: bergsicht.id, related_contact_id: anna.id, description: "Head of marketing" }, { trusted: true });

  const items = r("items");
  const hour = await id(ctx, "SELECT id FROM units ORDER BY id LIMIT 1");
  const piece = await id(ctx, "SELECT id FROM units ORDER BY id LIMIT 1 OFFSET 2");
  const consulting = await createRecord(ctx, items, { name: "Consulting", type: "service", unit_id: hour, sale_price: 180 }, { trusted: true });
  const dev = await createRecord(ctx, items, { name: "Web development", type: "service", unit_id: hour, sale_price: 160 }, { trusted: true });
  const hosting = await createRecord(ctx, items, { name: "Managed hosting (monthly)", type: "service", sale_price: 49 }, { trusted: true });
  const workshop = await createRecord(ctx, items, { name: "Strategy workshop (full day)", type: "service", sale_price: 1500 }, { trusted: true });
  const stand = await createRecord(ctx, items, { name: "Aluminium laptop stand", type: "product", unit_id: piece, sale_price: 89, purchase_price: 41, is_stock_tracked: true, supplier_id: office.id }, { trusted: true });
  await ctx.db.run("UPDATE items SET stock_quantity = 25 WHERE id = ?", stand.id);

  // Opening balances.
  const acc = (n: string) => id(ctx, "SELECT id FROM accounts WHERE number = ?", n);
  const opening = await acc("9100");
  await postEntry(ctx, {
    date: `${t.slice(0, 4)}-01-01`,
    description: "Opening balance",
    type: "opening",
    locked: false,
    lines: [
      { debit_account_id: await acc("1000"), credit_account_id: opening, amount: 80_000 },
      { debit_account_id: await acc("1020"), credit_account_id: opening, amount: 6_420_000 },
      { debit_account_id: await acc("1520"), credit_account_id: opening, amount: 820_000 },
      { debit_account_id: opening, credit_account_id: await acc("2800"), amount: 2_000_000 },
      { debit_account_id: opening, credit_account_id: await acc("2970"), amount: 5_320_000 },
    ],
  });
  const year = Number(t.slice(0, 4));
  const thisMonth = Number(t.slice(5, 7));
  const monthDate = (m: number, day: number) => `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  for (let m = 1; m <= thisMonth; m++) {
    await postEntry(ctx, {
      date: monthDate(m, 1),
      description: `Office rent ${String(m).padStart(2, "0")}/${year}`,
      type: "manual",
      locked: false,
      lines: [{ debit_account_id: await acc("6000"), credit_account_id: await acc("1020"), amount: 240_000 }],
    });
  }

  // Sales documents.
  const invoices = r("invoices");
  const pos = (item: Record<string, unknown>, quantity: number) => ({ type: "item", item_id: item.id, quantity });
  const quote = await createRecord(ctx, r("quotes"), {
    title: "Website relaunch",
    contact_id: bergsicht.id,
    contact_person_id: anna.id,
    date: d(-40),
    positions: [
      { type: "text", text: "Phase 1 – Concept and design" },
      pos(workshop, 1),
      pos(consulting, 12),
      { type: "subtotal" },
      { type: "text", text: "Phase 2 – Implementation" },
      pos(dev, 80),
      { type: "custom", text: "Optional: multilingual content migration", quantity: 1, unit_price: 2400, is_optional: true },
      { type: "discount", text: "Partner discount", discount_percent: 5 },
    ],
  }, { trusted: true });
  await issueDocument(ctx, await getRecord(ctx, r("quotes"), Number(quote.id)));

  await createRecord(ctx, r("orders"), {
    title: "Managed hosting",
    contact_id: rhein.id,
    date: d(-60),
    repetition: { interval: "monthly", every: 1, start: d(10) },
    next_run_date: d(10),
    positions: [pos(hosting, 1)],
  }, { trusted: true });

  // A year of history: monthly development & hosting invoices, paid about three weeks later.
  for (let m = 1; m <= thisMonth - 3; m++) {
    const date = monthDate(m, 12);
    const hours = 70 + ((m * 17) % 45);
    const history = await createRecord(
      ctx,
      invoices,
      {
        title: `Development & hosting ${String(m).padStart(2, "0")}/${year}`,
        contact_id: m % 3 === 0 ? bergsicht.id : rhein.id,
        date,
        positions: [pos(dev, hours), pos(hosting, 1), ...(m % 4 === 0 ? [pos(workshop, 1)] : [])],
      },
      { trusted: true },
    );
    const issued = await issueDocument(ctx, await getRecord(ctx, invoices, Number(history.id)));
    const paidOn = addDays(date, 18 + (m % 3) * 4);
    if (paidOn < t) await recordPayment(ctx, await getRecord(ctx, invoices, issued.id), { date: paidOn, amount: issued.total, title: "Payment received" });
  }

  const inv1 = await createRecord(ctx, invoices, { title: "Brand workshop", contact_id: roesterei.id, date: d(-50), positions: [pos(workshop, 1), pos(consulting, 4)] }, { trusted: true });
  const inv2 = await createRecord(ctx, invoices, { title: "Website maintenance Q3", contact_id: rhein.id, date: d(-38), positions: [pos(dev, 18), pos(hosting, 3)] }, { trusted: true });
  const inv3 = await createRecord(ctx, invoices, { title: "Création visuelle", contact_id: morel.id, date: d(-42), language: "fr", positions: [pos(consulting, 6), pos(stand, 3)] }, { trusted: true });
  await createRecord(ctx, invoices, { title: "Progetto web", contact_id: lugano.id, language: "it", positions: [pos(dev, 10)] }, { trusted: true });

  const issued1 = await issueDocument(ctx, await getRecord(ctx, invoices, Number(inv1.id)));
  await markSent(ctx, issued1 as unknown as Record<string, unknown>);
  await recordPayment(ctx, await getRecord(ctx, invoices, issued1.id), { date: d(-30), amount: issued1.total, title: "Payment received" });
  const issued2 = await issueDocument(ctx, await getRecord(ctx, invoices, Number(inv2.id)));
  await recordPayment(ctx, await getRecord(ctx, invoices, issued2.id), { date: d(-10), amount: Math.round(issued2.total / 2 / 5) * 5, title: "Partial payment" });
  const issued3 = await issueDocument(ctx, await getRecord(ctx, invoices, Number(inv3.id)));

  // Purchases.
  const vm81 = await id(ctx, "SELECT id FROM taxes WHERE code = 'VM81'");
  const vi81 = await id(ctx, "SELECT id FROM taxes WHERE code = 'VI81'");
  const bills = r("bills");
  const b1 = await createRecord(ctx, bills, { contact_id: cloud.id, vendor_nr: "SC-48211", title: "Cloud infrastructure September", date: d(-35), lines: [{ text: "Compute & storage", amount: 486.5, tax_id: vm81, account_id: await acc("4400") }] }, { trusted: true });
  await bookBill(ctx, await getRecord(ctx, bills, Number(b1.id)));
  await payBill(ctx, await getRecord(ctx, bills, Number(b1.id)), { date: d(-20) });
  const b2 = await createRecord(ctx, bills, { contact_id: office.id, vendor_nr: "HOS-2026-1177", title: "Office supplies", date: d(-6), due_date: d(24), lines: [{ text: "Paper, toner", amount: 312.4, tax_id: vi81, account_id: await acc("6500") }, { text: "Laptop stands (20 pcs)", amount: 886.4, tax_id: vm81, account_id: await acc("4200") }] }, { trusted: true });
  await bookBill(ctx, await getRecord(ctx, bills, Number(b2.id)));

  const expenses = r("expenses");
  const e1 = await createRecord(ctx, expenses, { title: "Train ticket Zürich–Zermatt", date: d(-41), amount: 128, tax_id: vi81, account_id: await acc("6200") }, { trusted: true });
  await bookExpense(ctx, await getRecord(ctx, expenses, Number(e1.id)));
  await createRecord(ctx, expenses, { title: "Client lunch Bergsicht", date: d(-3), amount: 86.5, tax_id: vi81, account_id: await acc("6700") }, { trusted: true });

  // Projects and time.
  const project = await createRecord(ctx, r("projects"), { name: "Website relaunch Bergsicht", contact_id: bergsicht.id, contact_person_id: anna.id, start_date: d(-30), budget_type: "hours", budget_hours: 120, hourly_rate: 160 }, { trusted: true });
  const activities = await ctx.db.all<{ id: number; name: string }>("SELECT id, name FROM business_activities");
  const act = (n: string) => activities.find((a) => a.name === n)?.id ?? null;
  for (const [offset, minutes, activity, text] of [
    [-28, 240, "Consulting", "Kick-off workshop"],
    [-25, 360, "Development", "Information architecture"],
    [-21, 480, "Development", "Design system & components"],
    [-14, 300, "Development", "Booking engine integration"],
    [-7, 120, "Project management", "Status meeting & planning"],
    [-2, 180, "Development", "Multilingual routing"],
  ] as [number, number, string, string][]) {
    await createRecord(ctx, r("timesheets"), { date: d(offset), duration_minutes: minutes, project_id: project.id, activity_id: act(activity), description: text, user_name: "Sandra Keller" }, { trusted: true });
  }
  for (const [subject, due, priority, status] of [
    ["Send revised sitemap to Anna Meier", d(2), "high", "todo"],
    ["Prepare VAT return Q3", d(5), "urgent", "todo"],
    ["Order new laptop stands", d(9), "normal", "in_progress"],
    ["Renew SSL certificates", d(-1), "normal", "done"],
  ] as [string, string, string, string][]) {
    await createRecord(ctx, r("tasks"), { subject, due_date: due, priority, status, project_id: subject.includes("sitemap") ? project.id : null, assignee_name: "Sandra Keller" }, { trusted: true });
  }

  // Payroll.
  const emp = r("employees");
  await createRecord(ctx, emp, { firstname: "Sandra", lastname: "Keller", job_title: "Lead developer", entry_date: "2023-03-01", monthly_salary: 8200, bvg_rate: 6, nbu_rate: 1.2, ktg_rate: 0.5, ahv_number: "756.9217.0769.85", city: "Zürich", postcode: "8004" }, { trusted: true });
  await createRecord(ctx, emp, { firstname: "Marco", lastname: "Rossi", job_title: "Project manager", entry_date: "2024-08-01", monthly_salary: 6000, workload_percent: 80, bvg_rate: 5.5, nbu_rate: 1.2, ktg_rate: 0.5, child_allowance: 215, city: "Winterthur", postcode: "8400" }, { trusted: true });
  for (let m = 1; m < thisMonth; m++) {
    await runPayroll(ctx, year, m);
    for (const slip of await ctx.db.all<{ id: number }>("SELECT id FROM payslips WHERE status = 'draft'")) {
      await finalizePayslip(ctx, await getRecord(ctx, r("payslips"), slip.id));
    }
  }

  // A bank statement with one payment matching the open invoice by QR reference.
  const bank = await id(ctx, "SELECT id FROM bank_accounts WHERE is_default = 1");
  const open3 = await getRecord(ctx, invoices, issued3.id);
  await importStatements(ctx, [
    {
      iban: null,
      transactions: [
        { bookingDate: d(-1), valueDate: d(-1), amount: Number(open3.amount_open), currency: "CHF", counterparty: "Atelier Morel Sàrl", counterpartyIban: null, reference: String(open3.qr_reference ?? ""), remittance: null, externalId: `demo-${Date.now()}-1` },
        { bookingDate: d(-1), valueDate: d(-1), amount: -1500, currency: "CHF", counterparty: "Zürcher Kantonalbank", counterpartyIban: null, reference: null, remittance: "Account maintenance fee", externalId: `demo-${Date.now()}-2` },
      ],
    },
  ], { bankAccountId: bank });
}
