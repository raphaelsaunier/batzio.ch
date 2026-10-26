import { today } from "@batzio/core/format";
import { createRecord, deleteRecord, getRecord } from "./crud";
import { assertCan, type Ctx } from "./ctx";
import { AppError, toAppError } from "./errors";
import { DEFAULT_SEQUENCES } from "./numbering";
import { bookBill, bookExpense, payBill } from "./purchases";
import { getResource } from "./resources/registry";
import type { Row } from "./resources/types";
import { cancelDocument, issueDocument, recordPayment, setDocumentStatus, writeOff } from "./sales";
import { getSettings, saveSettings } from "./settings";
import { createWire, type Mapping } from "./compat/table";
import {
  activityMapping,
  addressMapping,
  contactMapping,
  countryMapping,
  groupMapping,
  noteMapping,
  relationMapping,
  salutationMapping,
  sectorMapping,
  taskMapping,
  titleMapping,
  unitMapping,
} from "./compat/v2-contacts";
import { documentInput, KINDS, resourceFor } from "./compat/v2-documents";
import { itemMapping } from "./compat/v2-items";
import { milestoneMapping, packageMapping, projectMapping, timesheetMapping } from "./compat/v2-projects";
import { manualEntryInput } from "./compat/v3";
import { billInput, expenseInput } from "./compat/v4";
import { IMPORT_PHASES, PHASE_LABELS, type ImportPhase, type ImportProgress, type PhaseCount } from "./importer-phases";

/**
 * Moving in: copies a company out of other Swiss accounting software through
 * its REST API (the one Batzio's compatibility API speaks) — master data,
 * documents with their positions and payments, supplier bills, expenses and
 * manual bookings. It runs in short steps the client repeats, so it fits any
 * request time limit and survives interruptions; every source record is
 * remembered in `import_map`, so running it again only adds what is new.
 * The access token is never stored.
 */

export interface ImportSource {
  /** e.g. https://api.example.ch — the origin that serves /2.0, /3.0 and /4.0. */
  baseUrl: string;
  token: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export { IMPORT_PHASES, PHASE_LABELS, type ImportPhase, type ImportProgress, type PhaseCount } from "./importer-phases";

const STATE_KEY = "import";
const PAGE = 100;

// ------------------------------------------------------------------ source

class Source {
  constructor(private readonly s: ImportSource) {}

  async get<T = unknown>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${this.s.baseUrl.replace(/\/+$/, "")}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const doFetch = this.s.fetch ?? ((u: string, init?: RequestInit) => fetch(u, init));
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url.toString(), { headers: { Authorization: `Bearer ${this.s.token}`, Accept: "application/json" } });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new AppError("unauthorized", "Your previous software did not accept this access token.");
      if (!res.ok) throw new AppError("conflict", "Your previous software answered {status} for {path}.", undefined, { status: res.status, path });
      return (await res.json()) as T;
    }
  }
}

// ------------------------------------------------------------------ id map

class IdMap {
  private cache = new Map<string, number | null>();
  constructor(private readonly ctx: Ctx) {}

  async get(kind: string, sourceId: unknown): Promise<number | null> {
    if (sourceId === null || sourceId === undefined || sourceId === "") return null;
    const key = `${kind}:${sourceId}`;
    if (!this.cache.has(key)) {
      const id = await this.ctx.db.value<number>("SELECT target_id FROM import_map WHERE kind = ? AND source_id = ?", kind, String(sourceId));
      this.cache.set(key, id ?? null);
    }
    return this.cache.get(key) ?? null;
  }

  async set(kind: string, sourceId: unknown, targetId: number) {
    if (sourceId === null || sourceId === undefined || sourceId === "") return;
    await this.ctx.db.run("INSERT OR REPLACE INTO import_map (kind, source_id, target_id) VALUES (?, ?, ?)", kind, String(sourceId), targetId);
    this.cache.set(`${kind}:${sourceId}`, targetId);
  }
}

/** Which kind of record a reference field points at. */
const REF_KINDS: Record<string, string> = {
  contact_id: "contact",
  contact_sub_id: "contact",
  supplier_id: "contact",
  contact_partner_id: "contact",
  main_contact_id: "contact",
  article_id: "item",
  unit_id: "unit",
  tax_id: "tax",
  tax_income_id: "tax",
  tax_expense_id: "tax",
  account_id: "account",
  expense_account_id: "account",
  booking_account_id: "account",
  debit_account_id: "account",
  credit_account_id: "account",
  tax_account_id: "account",
  country_id: "country",
  language_id: "language",
  currency_id: "currency",
  bank_account_id: "bank_account",
  salutation_id: "salutation",
  title_id: "title",
  titel_id: "title",
  project_id: "project",
  pr_project_id: "project",
  pr_package_id: "package",
  pr_milestone_id: "milestone",
  client_service_id: "activity",
  contact_group_ids: "group",
  contact_branch_ids: "sector",
};

/** Rewrites source ids to Batzio ids, everywhere in a wire object; source record ids are dropped. */
async function translate(map: IdMap, value: unknown, key = ""): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => translate(map, v)));
  if (value && typeof value === "object") {
    const out: Row = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "id" || k === "uuid") continue;
      out[k] = await translate(map, v, k);
    }
    return out;
  }
  const kind = REF_KINDS[key];
  if (!kind || value === null || value === undefined || value === "") return value;
  if (kind === "group" || kind === "sector") {
    const ids = await Promise.all(String(value).split(",").map((s) => map.get(kind, s.trim())));
    return ids.filter(Boolean).join(",") || null;
  }
  return map.get(kind, value);
}

// ------------------------------------------------------------------ state

async function loadProgress(ctx: Ctx): Promise<ImportProgress | null> {
  const raw = await ctx.db.value<string>("SELECT value FROM settings WHERE key = ?", STATE_KEY);
  return raw ? (JSON.parse(raw) as ImportProgress) : null;
}

async function saveProgress(ctx: Ctx, p: ImportProgress) {
  await ctx.db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    STATE_KEY,
    JSON.stringify(p),
  );
}

export async function importProgress(ctx: Ctx): Promise<ImportProgress | null> {
  assertCan(ctx, "settings", "read");
  return loadProgress(ctx);
}

const fresh = (): ImportProgress => ({ phase: IMPORT_PHASES[0], cursor: 0, counts: {}, warnings: [], startedAt: new Date().toISOString(), finishedAt: null });

// ------------------------------------------------------------------ step

interface Run {
  ctx: Ctx;
  api: Source;
  map: IdMap;
  progress: ImportProgress;
  deadline: number;
}

const timeLeft = (run: Run) => Date.now() < run.deadline;

function count(run: Run, phase: ImportPhase, what: keyof PhaseCount) {
  const c = (run.progress.counts[phase] ??= { imported: 0, skipped: 0, failed: 0 });
  c[what]++;
}

function warn(run: Run, message: string) {
  if (run.progress.warnings.length < 60) run.progress.warnings.push(message);
}

/**
 * Imports for about `budgetMs` and returns the progress; call again until
 * `phase` is "done". `restart` starts over (records already imported are kept
 * and skipped).
 */
export async function importStep(ctx: Ctx, source: ImportSource, opts: { budgetMs?: number; restart?: boolean } = {}): Promise<ImportProgress> {
  assertCan(ctx, "settings", "write");
  if (!/^https?:\/\//.test(source.baseUrl)) throw new AppError("validation", "Enter the address of your previous software’s API.");
  if (!source.token.trim()) throw new AppError("validation", "Paste the access token from your previous software.");
  let progress = opts.restart ? null : await loadProgress(ctx);
  if (!progress || progress.phase === "done") progress = fresh();
  const run: Run = { ctx, api: new Source(source), map: new IdMap(ctx), progress, deadline: Date.now() + (opts.budgetMs ?? 8_000) };

  while (run.progress.phase !== "done" && timeLeft(run)) {
    const phase = run.progress.phase;
    const finished = await PHASES[phase](run);
    if (finished) {
      const next = IMPORT_PHASES[IMPORT_PHASES.indexOf(phase) + 1];
      run.progress.phase = next ?? "done";
      run.progress.cursor = 0;
      if (!next) {
        await continueSequences(ctx);
        run.progress.finishedAt = new Date().toISOString();
      }
    }
    await saveProgress(ctx, run.progress);
  }
  await saveProgress(ctx, run.progress);
  return run.progress;
}

/**
 * Walks a list endpoint from the saved cursor, one record at a time, until it
 * ends (true) or the step's time is up (false).
 */
async function walk(
  run: Run,
  phase: ImportPhase,
  fetchPage: (offset: number) => Promise<Row[]>,
  handle: (row: Row) => Promise<"imported" | "skipped">,
): Promise<boolean> {
  while (timeLeft(run)) {
    const rows = await fetchPage(run.progress.cursor);
    if (!rows.length) return true;
    for (const row of rows) {
      if (!timeLeft(run)) return false;
      try {
        count(run, phase, await handle(row));
      } catch (error) {
        count(run, phase, "failed");
        warn(run, `${PHASE_LABELS[phase]} #${row.id ?? "?"}: ${toAppError(error).message}`);
      }
      run.progress.cursor++;
    }
    if (rows.length < PAGE) return true;
  }
  return false;
}

const offsetPage = (run: Run, path: string, query: Record<string, string | number> = {}) => (offset: number) =>
  run.api.get<Row[]>(path, { ...query, limit: PAGE, offset, order_by: "id" });

const envelopePage = (run: Run, path: string) => async (offset: number) =>
  (await run.api.get<{ data: Row[] }>(path, { limit: PAGE, page: Math.floor(offset / PAGE) + 1, sort: "id", order: "asc" })).data.slice(offset % PAGE);

/** Creates a record unless it was imported before; numbers that already exist are dropped. */
async function once(run: Run, kind: string, sourceId: unknown, create: () => Promise<number>): Promise<"imported" | "skipped"> {
  if (await run.map.get(kind, sourceId)) return "skipped";
  const id = await create();
  await run.map.set(kind, sourceId, id);
  return "imported";
}

async function createNumbered(ctx: Ctx, m: Mapping, body: Row, numberKeys: string[], extra: Row = {}): Promise<number> {
  try {
    return Number((await createWire(ctx, m, body, extra)).id);
  } catch (error) {
    if (toAppError(error).code !== "conflict" || !numberKeys.some((k) => body[k])) throw error;
    const rest = Object.fromEntries(Object.entries(body).filter(([k]) => !numberKeys.includes(k)));
    return Number((await createWire(ctx, m, rest, extra)).id);
  }
}

// ------------------------------------------------------------------ phases

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Lists matched by name, created when missing. */
async function matchByName(run: Run, kind: string, path: string, m: Mapping) {
  const rows = await run.api.get<Row[]>(path, { limit: 2000 });
  const ours = await run.ctx.db.all<Row>(`SELECT id, name FROM ${m.table}`);
  for (const r of rows) {
    if (await run.map.get(kind, r.id)) continue;
    const hit = ours.find((o) => lower(o.name) === lower(r.name));
    const id = hit ? Number(hit.id) : Number((await createWire(run.ctx, m, { name: r.name })).id);
    await run.map.set(kind, r.id, id);
  }
}

async function referencePhase(run: Run): Promise<boolean> {
  const { ctx, api, map } = run;
  // Countries and languages by ISO code.
  const countries = await ctx.db.all<Row>("SELECT id, code FROM countries");
  for (const c of await api.get<Row[]>("/2.0/country", { limit: 2000 })) {
    const hit = countries.find((o) => lower(o.code) === lower(c.iso3166_alpha2));
    const id = hit ? Number(hit.id) : Number((await createWire(ctx, countryMapping, { name: c.name, iso3166_alpha2: c.iso3166_alpha2 })).id);
    await map.set("country", c.id, id);
  }
  const languages = await ctx.db.all<Row>("SELECT id, code FROM languages");
  for (const l of await api.get<Row[]>("/2.0/language", { limit: 2000 })) {
    const hit = languages.find((o) => lower(o.code) === lower(l.iso_639_1));
    if (hit) await map.set("language", l.id, Number(hit.id));
  }
  await matchByName(run, "salutation", "/2.0/salutation", salutationMapping);
  await matchByName(run, "title", "/2.0/title", titleMapping);
  await matchByName(run, "group", "/2.0/contact_group", groupMapping);
  await matchByName(run, "sector", "/2.0/contact_branch", sectorMapping);
  await matchByName(run, "unit", "/2.0/unit", unitMapping);

  // Currencies by ISO code.
  const currencies = await ctx.db.all<Row>("SELECT id, code FROM currencies");
  for (const c of await api.get<Row[]>("/3.0/currencies", { limit: 2000 })) {
    let hit = currencies.find((o) => lower(o.code) === lower(c.name));
    if (!hit && /^[A-Z]{3}$/i.test(String(c.name))) {
      hit = await createRecord(ctx, getResource("currencies")!, { code: String(c.name).toUpperCase(), name: String(c.name).toUpperCase(), rounding: Number(c.round_factor ?? 0.01) });
    }
    if (hit) await map.set("currency", c.id, Number(hit.id));
  }

  // VAT codes by direction and rate; Batzio keeps its own (current Swiss) codes.
  const taxes = await ctx.db.all<Row>("SELECT id, type, rate, is_active FROM taxes ORDER BY is_active DESC, id");
  for (const t of await api.get<Row[]>("/3.0/taxes", { limit: 2000 })) {
    const sales = String(t.type ?? "").includes("sales") || t.type === "not_taxable_turnover" || t.type === "net_tax";
    const hit = taxes.find((o) => o.type === (sales ? "sales" : "purchase") && Math.abs(Number(o.rate) - Number(t.value)) < 0.001);
    if (hit) await map.set("tax", t.id, Number(hit.id));
    else warn(run, `VAT code ${t.code ?? t.id} (${t.value} %) has no match; positions using it are imported without VAT code.`);
  }

  // Ledger accounts by number.
  const accounts = await ctx.db.all<Row>("SELECT id, number FROM accounts");
  const TYPE: Record<number, string> = { 1: "revenue", 2: "expense", 3: "asset", 4: "liability", 5: "equity" };
  for (const a of await api.get<Row[]>("/2.0/accounts", { limit: 2000 })) {
    const hit = accounts.find((o) => String(o.number) === String(a.account_no));
    const id = hit
      ? Number(hit.id)
      : Number((await createRecord(ctx, getResource("accounts")!, { number: String(a.account_no), name: a.name, type: TYPE[Number(a.account_type)] ?? "asset" })).id);
    await map.set("account", a.id, id);
    if (a.uuid) await map.set("account", a.uuid, id);
  }

  // Bank accounts by IBAN.
  const banks = await ctx.db.all<Row>("SELECT id, iban FROM bank_accounts");
  const iban = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toUpperCase();
  for (const b of await api.get<Row[]>("/3.0/banking/accounts", { limit: 2000 })) {
    let hit = banks.find((o) => iban(o.iban) && iban(o.iban) === iban(b.iban_nr));
    if (!hit) {
      hit = await createRecord(ctx, getResource("bank_accounts")!, {
        name: b.name || "Bank",
        bank_name: b.bank_name || null,
        iban: iban(b.iban_nr) || null,
        qr_iban: iban(b.qr_invoice_iban) || null,
        currency_code: (await ctx.db.value<string>("SELECT code FROM currencies WHERE id = ?", await map.get("currency", b.currency_id))) ?? "CHF",
        account_id: await map.get("account", b.account_id),
      });
    }
    await map.set("bank_account", b.id, Number(hit.id));
    if (b.uuid) await map.set("bank_account", b.uuid, Number(hit.id));
  }

  // Activities (for time tracking) by name.
  const activities = await ctx.db.all<Row>("SELECT id, name FROM business_activities");
  for (const a of await api.get<Row[]>("/2.0/client_service", { limit: 2000 })) {
    const hit = activities.find((o) => lower(o.name) === lower(a.name));
    const id = hit ? Number(hit.id) : Number((await createWire(ctx, activityMapping, (await translate(map, a)) as Row)).id);
    await map.set("activity", a.id, id);
  }
  return true;
}

async function companyPhase(run: Run): Promise<boolean> {
  const [profile] = await run.api.get<Row[]>("/2.0/company_profile");
  if (!profile) return true;
  const current = await getSettings(run.ctx, "company");
  const patch: Row = {};
  const fill = (key: keyof typeof current, value: unknown) => {
    if (!current[key] && value) patch[key] = value;
  };
  fill("name", profile.name);
  fill("street", profile.address);
  fill("house_number", profile.address_nr);
  fill("postcode", profile.postcode);
  fill("city", profile.city);
  fill("email", profile.mail);
  fill("phone", profile.phone_fixed);
  fill("website", profile.url);
  fill("vat_number", profile.mwst_nr || profile.ust_id_nr);
  fill("commercial_register", profile.trade_register_nr);
  if (Object.keys(patch).length) await saveSettings(run.ctx, "company", patch as Partial<typeof current>);
  count(run, "company", Object.keys(patch).length ? "imported" : "skipped");
  return true;
}

async function contactsPhase(run: Run, archived: boolean): Promise<boolean> {
  const phase = archived ? "archived_contacts" : "contacts";
  return walk(run, phase, offsetPage(run, "/2.0/contact", archived ? { show_archived: "true" } : {}), (c) =>
    once(run, "contact", c.id, async () => {
      const body = (await translate(run.map, c)) as Row;
      const id = await createNumbered(run.ctx, contactMapping, body, ["nr"]);
      for (const a of await run.api.get<Row[]>(`/2.0/contact/${c.id}/additional_address`, { limit: 2000 })) {
        await createWire(run.ctx, addressMapping, (await translate(run.map, a)) as Row, { contact_id: id });
      }
      if (archived) await deleteRecord(run.ctx, getResource("contacts")!, id);
      return id;
    }),
  );
}

const simple = (phase: ImportPhase, kind: string, path: string, m: Mapping, numberKeys?: string[]) => (run: Run) =>
  walk(run, phase, offsetPage(run, path), (row) =>
    once(run, kind, row.id, async () => {
      const body = (await translate(run.map, row)) as Row;
      return numberKeys ? createNumbered(run.ctx, m, body, numberKeys) : Number((await createWire(run.ctx, m, body)).id);
    }),
  );

async function projectsPhase(run: Run): Promise<boolean> {
  return walk(run, "projects", offsetPage(run, "/2.0/pr_project"), (p) =>
    once(run, "project", p.id, async () => {
      const id = await createNumbered(run.ctx, projectMapping, (await translate(run.map, p)) as Row, ["nr", "document_nr"]);
      if (p.uuid) await run.map.set("project", p.uuid, id);
      for (const m of await run.api.get<Row[]>(`/3.0/projects/${p.id}/milestones`, { limit: 2000 })) {
        const mid = Number((await createWire(run.ctx, milestoneMapping, (await translate(run.map, m)) as Row, { project_id: id })).id);
        await run.map.set("milestone", m.id, mid);
      }
      for (const w of await run.api.get<Row[]>(`/3.0/projects/${p.id}/packages`, { limit: 2000 })) {
        const wid = Number((await createWire(run.ctx, packageMapping, (await translate(run.map, w)) as Row, { project_id: id })).id);
        await run.map.set("package", w.id, wid);
      }
      return id;
    }),
  );
}

/** Sales documents keep their numbers and are brought to the state they had. */
function documentsPhase(phase: ImportPhase, type: "kb_offer" | "kb_order" | "kb_invoice") {
  const k = KINDS[type];
  return (run: Run) =>
    walk(run, phase, offsetPage(run, `/2.0/${type}`), (listed) =>
      once(run, type, listed.id, async () => {
        const full = await run.api.get<Row>(`/2.0/${type}/${listed.id}`);
        const body = (await translate(run.map, full)) as Row;
        const res = resourceFor(k.kind);
        const input = await documentInput(run.ctx, body, null);
        input.nr = full.document_nr || undefined;
        let doc: Row;
        try {
          doc = await createRecord(run.ctx, res, input);
        } catch (error) {
          if (toAppError(error).code !== "conflict") throw error;
          delete input.nr;
          doc = await createRecord(run.ctx, res, input);
        }
        try {
          await replayStatus(run, type, full, Number(doc.id));
        } catch (error) {
          warn(run, `${PHASE_LABELS[phase]} ${full.document_nr ?? listed.id}: imported as draft (${toAppError(error).message})`);
        }
        return Number(doc.id);
      }),
    );
}

async function replayStatus(run: Run, type: string, full: Row, id: number) {
  const status = Number(full.kb_item_status_id);
  const res = resourceFor(KINDS[type].kind);
  const reload = () => getRecord(run.ctx, res, id);
  if (type === "kb_offer") {
    if (status === 1) return;
    await issueDocument(run.ctx, await reload());
    if (status === 3) await setDocumentStatus(run.ctx, await reload(), "accepted", { accepted_at: new Date().toISOString() });
    if (status === 4) await setDocumentStatus(run.ctx, await reload(), "rejected", { rejected_at: new Date().toISOString() });
    return;
  }
  if (type === "kb_order") {
    if (status === 6 || status === 15 || status === 21) await issueDocument(run.ctx, await reload());
    if (status === 6) await setDocumentStatus(run.ctx, await reload(), "done");
    if (status === 21) await cancelDocument(run.ctx, await reload());
    return;
  }
  // Invoices: issue (books receivables, revenue and VAT), then replay payments.
  if (status === 7) return;
  await issueDocument(run.ctx, await reload());
  if (status === 19) {
    await cancelDocument(run.ctx, await reload());
    return;
  }
  for (const p of await run.api.get<Row[]>(`/2.0/kb_invoice/${full.id}/payment`, { limit: 2000 })) {
    await recordPayment(run.ctx, await reload(), {
      date: String(p.date ?? today()).slice(0, 10),
      amount: Math.round(Number(p.value) * 100),
      bank_account_id: await run.map.get("bank_account", p.bank_account_id),
      payment_type_id: null,
      title: null,
      is_cash_discount: Boolean(p.is_cash_discount),
    });
  }
  if (status === 31) await writeOff(run.ctx, await reload(), String(full.is_valid_to ?? today()).slice(0, 10));
}

function billsPhase(run: Run): Promise<boolean> {
  return walk(run, "bills", envelopePage(run, "/4.0/purchase/bills"), (listed) =>
    once(run, "bill", listed.id, async () => {
      const full = await run.api.get<Row>(`/4.0/purchase/bills/${listed.id}`);
      const body = (await translate(run.map, { ...full, attachment_ids: [] })) as Row;
      const input = await billInput(run.ctx, body);
      input.nr = full.document_no || undefined;
      const lines = ((input.lines as Row[]) ?? []).map(({ _discount, ...l }) => l);
      const res = getResource("bills")!;
      let bill: Row;
      try {
        bill = await createRecord(run.ctx, res, { ...input, lines });
      } catch (error) {
        if (toAppError(error).code !== "conflict") throw error;
        bill = await createRecord(run.ctx, res, { ...input, nr: undefined, lines });
      }
      const status = String(full.status ?? "DRAFT");
      if (status !== "DRAFT") {
        try {
          await bookBill(run.ctx, await getRecord(run.ctx, res, Number(bill.id)));
          if (status === "PAID" || status === "PARTIALLY_PAID") {
            const paid = Math.round((Number(full.amount_calc ?? full.gross ?? 0) - Number(full.pending_amount ?? 0)) * 100);
            if (paid > 0) await payBill(run.ctx, await getRecord(run.ctx, res, Number(bill.id)), { date: String(full.due_date ?? today()).slice(0, 10), amount: paid });
          }
        } catch (error) {
          warn(run, `Supplier bill ${full.document_no ?? listed.id}: imported as draft (${toAppError(error).message})`);
        }
      }
      return Number(bill.id);
    }),
  );
}

function expensesPhase(run: Run): Promise<boolean> {
  return walk(run, "expenses", envelopePage(run, "/4.0/expenses"), (listed) =>
    once(run, "expense", listed.id, async () => {
      const full = await run.api.get<Row>(`/4.0/expenses/${listed.id}`);
      const body = (await translate(run.map, { ...full, attachment_ids: [] })) as Row;
      const input = await expenseInput(run.ctx, body);
      input.title ||= String(full.lastname_company ?? full.title ?? "Expense");
      const res = getResource("expenses")!;
      const expense = await createRecord(run.ctx, res, { ...input, nr: full.document_no || undefined }).catch(async (error) => {
        if (toAppError(error).code !== "conflict") throw error;
        return createRecord(run.ctx, res, input);
      });
      if (full.status === "DONE") {
        try {
          await bookExpense(run.ctx, await getRecord(run.ctx, res, Number(expense.id)));
        } catch (error) {
          warn(run, `Expense ${full.document_no ?? listed.id}: imported as draft (${toAppError(error).message})`);
        }
      }
      return Number(expense.id);
    }),
  );
}

function entriesPhase(run: Run): Promise<boolean> {
  return walk(run, "entries", offsetPage(run, "/3.0/accounting/manual_entries"), async (entry) => {
    // Bookings the source generated from documents are recreated by issuing those documents.
    if (entry.locked_info === "is_generated") return "skipped";
    return once(run, "entry", entry.id, async () => {
      const body = (await translate(run.map, entry)) as Row;
      const input = await manualEntryInput(run.ctx, body, null);
      input.ref_nr = entry.reference_nr || null;
      return Number((await createRecord(run.ctx, getResource("journal_entries")!, input)).id);
    });
  });
}

const PHASES: Record<ImportPhase, (run: Run) => Promise<boolean>> = {
  company: companyPhase,
  reference: referencePhase,
  contacts: (run) => contactsPhase(run, false),
  archived_contacts: (run) => contactsPhase(run, true),
  relations: simple("relations", "relation", "/2.0/contact_relation", relationMapping),
  items: simple("items", "item", "/2.0/article", itemMapping, ["intern_code"]),
  projects: projectsPhase,
  timesheets: simple("timesheets", "timesheet", "/2.0/timesheet", timesheetMapping),
  notes: simple("notes", "note", "/2.0/note", noteMapping),
  tasks: simple("tasks", "task", "/2.0/task", taskMapping),
  quotes: documentsPhase("quotes", "kb_offer"),
  orders: documentsPhase("orders", "kb_order"),
  invoices: documentsPhase("invoices", "kb_invoice"),
  bills: billsPhase,
  expenses: expensesPhase,
  entries: entriesPhase,
};

// ------------------------------------------------------------------ numbering

const NUMBERED: [key: string, table: string, kind?: string][] = [
  ["contact", "contacts"],
  ["item", "items"],
  ["project", "projects"],
  ["quote", "documents", "quote"],
  ["order", "documents", "order"],
  ["invoice", "documents", "invoice"],
  ["delivery", "documents", "delivery"],
  ["credit_note", "documents", "credit_note"],
  ["bill", "bills"],
  ["expense", "expenses"],
];

/** Batzio's number sequences continue after the highest imported number. */
async function continueSequences(ctx: Ctx) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  for (const [key, table, kind] of NUMBERED) {
    const def = DEFAULT_SEQUENCES.find((s) => s.key === key);
    const seq = await ctx.db.first<Row>("SELECT * FROM sequences WHERE key = ?", key);
    const format = String(seq?.format ?? def?.format ?? "{####}");
    const escaped = format.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `^${escaped
        .replace(/\{YYYY\}/g, year)
        .replace(/\{YY\}/g, year.slice(2))
        .replace(/\{MM\}/g, String(now.getUTCMonth() + 1).padStart(2, "0"))
        .replace(/\{#+\}/, "(\\d+)")}$`,
    );
    const rows = await ctx.db.all<{ nr: string }>(`SELECT nr FROM ${table} WHERE nr IS NOT NULL${kind ? " AND kind = ?" : ""}`, ...(kind ? [kind] : []));
    const highest = rows.reduce((max, r) => Math.max(max, Number(pattern.exec(r.nr)?.[1] ?? 0)), 0);
    if (!highest) continue;
    if (!seq) {
      await ctx.db.run(
        "INSERT INTO sequences (key, format, next_value, reset, last_year) VALUES (?, ?, ?, ?, ?)",
        key,
        format,
        highest + 1,
        def?.reset ?? "yearly",
        now.getUTCFullYear(),
      );
    } else if (Number(seq.next_value) <= highest || (seq.reset === "yearly" && Number(seq.last_year) !== now.getUTCFullYear())) {
      await ctx.db.run("UPDATE sequences SET next_value = ?, last_year = ? WHERE key = ?", highest + 1, now.getUTCFullYear(), key);
    }
  }
}
