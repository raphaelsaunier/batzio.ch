import { parseJsonArray, restoreRecord } from "../crud";
import type { Ctx } from "../ctx";
import { notFound } from "../errors";
import { getResource } from "../resources/registry";
import type { Row } from "../resources/types";
import { getSettings } from "../settings";
import { countryCode, countryId, languageCode, languageId, userIdFor, userOf } from "./lookup";
import { createWire, crud, deleteWire, has, listWire, pick, searchWire, selectRows, updateWire, wire, type Mapping } from "./table";
import { bodyObject, bool, created, date, datetime, ok, pathId, route, uuidFor, TAG, type Route } from "./wire";

/** Fixed lists, numbered from 1 in the order given. */
export function codeList(names: [string, string][]) {
  return {
    rows: () => names.map(([, name], i) => ({ id: i + 1, name })),
    id: (code: unknown) => {
      const i = names.findIndex(([c]) => c === code);
      return i >= 0 ? i + 1 : null;
    },
    code: (id: unknown) => names[Number(id) - 1]?.[0] ?? null,
    sql: (column: string) => `CASE ${column} ${names.map(([c], i) => `WHEN '${c}' THEN ${i + 1}`).join(" ")} END`,
  };
}

export const TODO_STATUS = codeList([
  ["todo", "Open"],
  ["in_progress", "In progress"],
  ["done", "Done"],
  ["cancelled", "Cancelled"],
]);
export const TODO_PRIORITY = codeList([
  ["low", "Low"],
  ["normal", "Normal"],
  ["high", "High"],
  ["urgent", "Urgent"],
]);
export const COMMUNICATION_KINDS = codeList([
  ["phone", "Phone"],
  ["email", "Email"],
  ["meeting", "Meeting"],
  ["letter", "Letter"],
  ["video", "Video call"],
]);
/** 1 earnings, 2 expenditure, 3 assets, 4 liabilities (equity included), 5 closing. */
const ACCOUNT_TYPE: Record<string, number> = { revenue: 1, expense: 2, asset: 3, liability: 4, equity: 4 };

const tags = (v: unknown) => parseJsonArray<number | string>(v).map(String);
const nullIfEmpty = (v: unknown) => (v === "" || v === undefined ? null : v);

// ------------------------------------------------------------------ contacts

export const contactMapping: Mapping = {
  table: "contacts",
  area: "contacts",
  resource: "contacts",
  label: "Contact",
  filter: (q) => ({ sql: bool(q.get("show_archived")) ? "archived_at IS NOT NULL" : "archived_at IS NULL" }),
  columns: {
    id: "id",
    nr: "nr",
    contact_type_id: { sql: "CASE type WHEN 'person' THEN 2 ELSE 1 END" },
    name_1: "name_1",
    name_2: "name_2",
    salutation_id: "salutation_id",
    title_id: "title_id",
    birthday: "birthday",
    street_name: "street",
    house_number: "house_number",
    address_addition: "address_addition",
    postcode: "postcode",
    city: "city",
    country_id: { sql: "(SELECT id FROM countries WHERE upper(code) = upper(contacts.country_code))" },
    mail: "email",
    mail_second: "email_2",
    phone_fixed: "phone",
    phone_mobile: "phone_mobile",
    url: "website",
    remarks: "remarks",
    language_id: { sql: "(SELECT id FROM languages WHERE lower(code) = lower(contacts.language))" },
    contact_group_ids: "group_ids",
    contact_branch_ids: { sql: "CAST(sector_id AS TEXT)" },
    updated_at: "updated_at",
  },
  extras: ["salutation_form", "phone_fixed_second", "fax", "skype_name", "is_lead"],
  read: async (r, ctx) => ({
    id: r.id,
    nr: r.nr ?? null,
    contact_type_id: r.type === "person" ? 2 : 1,
    name_1: r.name_1,
    name_2: r.name_2 ?? null,
    salutation_id: r.salutation_id ?? null,
    salutation_form: null,
    title_id: r.title_id ?? null,
    titel_id: r.title_id ?? null,
    birthday: date(r.birthday),
    address: [r.street, r.house_number].filter(Boolean).join(" ") || null,
    street_name: r.street ?? null,
    house_number: r.house_number ?? null,
    address_addition: r.address_addition ?? null,
    postcode: r.postcode ?? null,
    city: r.city ?? null,
    country_id: await countryId(ctx, r.country_code),
    mail: r.email ?? null,
    mail_second: r.email_2 ?? null,
    phone_fixed: r.phone ?? null,
    phone_fixed_second: null,
    phone_mobile: r.phone_mobile ?? null,
    fax: null,
    url: r.website ?? null,
    skype_name: null,
    remarks: r.remarks ?? null,
    language_id: await languageId(ctx, r.language),
    is_lead: false,
    contact_group_ids: tags(r.group_ids).join(",") || null,
    contact_branch_ids: r.sector_id ? String(r.sector_id) : null,
    user_id: userOf(ctx, r.owner_user_id),
    owner_id: userOf(ctx, r.owner_user_id),
    updated_at: datetime(r.updated_at),
  }),
  write: async (b, ctx) => {
    const out = pick(b, {
      nr: "nr",
      contact_type_id: (v) => ({ type: Number(v) === 2 ? "person" : "company" }),
      name_1: "name_1",
      name_2: "name_2",
      salutation_id: (v) => ({ salutation_id: nullIfEmpty(v) }),
      titel_id: (v) => ({ title_id: nullIfEmpty(v) }),
      title_id: (v) => ({ title_id: nullIfEmpty(v) }),
      birthday: (v) => ({ birthday: date(v) }),
      street_name: "street",
      house_number: "house_number",
      address_addition: "address_addition",
      postcode: "postcode",
      city: "city",
      mail: "email",
      mail_second: "email_2",
      phone_fixed: "phone",
      phone_mobile: "phone_mobile",
      url: "website",
      remarks: "remarks",
      contact_group_ids: (v) => ({ group_ids: String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number) }),
      contact_branch_ids: (v) => ({ sector_id: Number(String(v ?? "").split(",")[0]) || null }),
    });
    if (has(b, "country_id")) out.country_code = (await countryCode(ctx, b.country_id)) ?? "CH";
    if (has(b, "language_id")) out.language = (await languageCode(ctx, b.language_id)) ?? "de";
    const owner = has(b, "owner_id") ? b.owner_id : b.user_id;
    if (owner !== undefined) out.owner_user_id = (await userIdFor(ctx, owner)) ?? ctx.user?.id;
    return out;
  },
};

export const addressMapping: Mapping = {
  table: "additional_addresses",
  area: "contacts",
  resource: "additional_addresses",
  label: "Address",
  columns: { id: "id", name: "name", street_name: "street", postcode: "postcode", city: "city", description: "description" },
  extras: ["name_addition", "address_addition", "subject"],
  read: async (r, ctx) => ({
    id: r.id,
    contact_id: r.contact_id,
    contact_sub_id: null,
    name: r.name,
    name_addition: null,
    address: [r.street, r.house_number].filter(Boolean).join(" ") || null,
    street_name: r.street ?? null,
    house_number: r.house_number ?? null,
    address_addition: null,
    postcode: r.postcode ?? null,
    city: r.city ?? null,
    country_id: await countryId(ctx, r.country_code),
    subject: null,
    description: r.description ?? null,
  }),
  write: async (b, ctx) => {
    const out = pick(b, { name: "name", street_name: "street", house_number: "house_number", postcode: "postcode", city: "city", description: "description" });
    if (has(b, "country_id")) out.country_code = (await countryCode(ctx, b.country_id)) ?? "CH";
    return out;
  },
};

export const relationMapping: Mapping = {
  table: "contact_relations",
  area: "contacts",
  resource: "contact_relations",
  label: "Contact relation",
  columns: { id: "id", contact_id: "contact_id", contact_sub_id: "related_contact_id", description: "description", updated_at: "updated_at" },
  read: (r) => ({ id: r.id, contact_id: r.contact_id, contact_sub_id: r.related_contact_id, description: r.description ?? null, updated_at: datetime(r.updated_at) }),
  write: (b) => pick(b, { contact_id: "contact_id", contact_sub_id: "related_contact_id", description: "description" }),
};

/** id + name lists Batzio keeps as plain tables. */
function nameList(table: string, label: string, area: Mapping["area"] = "contacts", extra: Partial<Mapping> = {}): Mapping {
  return {
    table,
    area,
    label,
    rawColumns: ["name"],
    columns: { id: "id", name: "name" },
    defaultOrder: "id",
    read: (r) => ({ id: r.id, name: r.name }),
    write: (b) => pick(b, { name: "name" }),
    ...extra,
  };
}

export const countryMapping: Mapping = {
  table: "countries",
  area: "contacts",
  resource: "countries",
  label: "Country",
  columns: { id: "id", name: "name", name_short: "code", iso3166_alpha2: "code" },
  read: (r) => ({ id: r.id, name: r.name, name_short: r.code, iso3166_alpha2: r.code }),
  write: (b) => pick(b, { name: "name", iso3166_alpha2: (v) => ({ code: String(v).toUpperCase() }), name_short: (v, body) => (has(body, "iso3166_alpha2") ? {} : { code: String(v).toUpperCase() }) }),
};

const languageMapping: Mapping = {
  table: "languages",
  area: "contacts",
  label: "Language",
  columns: { id: "id", name: "name", iso_639_1: "code" },
  read: (r) => ({ id: r.id, name: r.name, decimal_point: ".", thousands_separator: "’", date_format_id: 1, date_format: "d.m.Y", iso_639_1: String(r.code).toLowerCase() }),
};

export const noteMapping: Mapping = {
  table: "notes",
  area: "contacts",
  resource: "notes",
  label: "Note",
  columns: { id: "id", subject: "subject", event_start: "event_date", contact_id: "contact_id", project_id: "project_id", pr_project_id: "project_id", info: "body" },
  extras: ["entry_id", "module_id"],
  read: (r, ctx) => ({
    id: r.id,
    user_id: userOf(ctx, r.user_id),
    event_start: datetime(r.event_date),
    subject: r.subject,
    info: r.body ?? null,
    contact_id: r.contact_id ?? null,
    project_id: r.project_id ?? null,
    pr_project_id: r.project_id ?? null,
    entry_id: null,
    module_id: null,
  }),
  write: async (b, ctx) => {
    const out = pick(b, {
      subject: "subject",
      info: "body",
      event_start: (v) => ({ event_date: date(v) }),
      contact_id: "contact_id",
      project_id: "project_id",
      pr_project_id: "project_id",
    });
    if (has(b, "user_id")) out.user_id = (await userIdFor(ctx, b.user_id)) ?? ctx.user?.id;
    return out;
  },
};

export const taskMapping: Mapping = {
  table: "tasks",
  area: "projects",
  resource: "tasks",
  label: "Task",
  columns: {
    id: "id",
    subject: "subject",
    finish_date: "due_date",
    contact_id: "contact_id",
    project_id: "project_id",
    pr_project_id: "project_id",
    todo_status_id: { sql: TODO_STATUS.sql("status") },
    todo_priority_id: { sql: TODO_PRIORITY.sql("priority") },
  },
  extras: ["place", "sub_contact_id", "entry_id", "module_id", "has_reminder", "have_remember", "remember_type_id", "remember_time_id", "communication_kind_id"],
  read: (r, ctx) => ({
    id: r.id,
    user_id: userOf(ctx, r.assignee_user_id),
    finish_date: r.due_date ? `${date(r.due_date)} 00:00:00` : null,
    subject: r.subject,
    place: null,
    info: r.description ?? null,
    contact_id: r.contact_id ?? null,
    sub_contact_id: null,
    project_id: r.project_id ?? null,
    pr_project_id: r.project_id ?? null,
    entry_id: null,
    module_id: null,
    todo_status_id: TODO_STATUS.id(r.status) ?? 1,
    todo_priority_id: TODO_PRIORITY.id(r.priority),
    has_reminder: false,
    have_remember: false,
    remember_type_id: null,
    remember_time_id: null,
    communication_kind_id: null,
  }),
  write: async (b, ctx) => {
    const out = pick(b, {
      subject: "subject",
      info: "description",
      finish_date: (v) => ({ due_date: date(v) }),
      contact_id: "contact_id",
      project_id: "project_id",
      pr_project_id: "project_id",
      todo_status_id: (v) => ({ status: TODO_STATUS.code(v) ?? "todo" }),
      todo_priority_id: (v) => ({ priority: TODO_PRIORITY.code(v) ?? "normal" }),
    });
    if (has(b, "user_id")) {
      const member = await userIdFor(ctx, b.user_id);
      out.assignee_user_id = member ?? ctx.user?.id;
    }
    return out;
  },
};

export const activityMapping: Mapping = {
  table: "business_activities",
  area: "projects",
  resource: "business_activities",
  label: "Activity",
  columns: { id: "id", name: "name", default_is_billable: "is_billable", default_price_per_hour: "hourly_rate", account_id: "account_id" },
  read: (r) => ({
    id: r.id,
    name: r.name,
    default_is_billable: r.is_billable === null || r.is_billable === undefined ? null : bool(r.is_billable),
    default_price_per_hour: r.hourly_rate === null || r.hourly_rate === undefined ? null : Number(r.hourly_rate),
    account_id: r.account_id ?? null,
  }),
  write: (b) => pick(b, { name: "name", default_is_billable: (v) => ({ is_billable: bool(v) }), default_price_per_hour: "hourly_rate", account_id: "account_id" }),
};

const accountMapping: Mapping = {
  table: "accounts",
  area: "accounting",
  label: "Account",
  columns: { id: "id", account_no: "number", name: "name", fibu_account_group_id: "group_id", is_active: "is_active", tax_id: "default_tax_id", account_type: { sql: "CASE type WHEN 'revenue' THEN 1 WHEN 'expense' THEN 2 WHEN 'asset' THEN 3 ELSE 4 END" } },
  defaultOrder: "account_no",
  read: (r) => ({
    id: r.id,
    uuid: uuidFor(TAG.account, Number(r.id)),
    account_no: String(r.number),
    name: r.name,
    account_type: ACCOUNT_TYPE[String(r.type)] ?? 5,
    tax_id: r.default_tax_id ?? null,
    fibu_account_group_id: r.group_id ?? null,
    is_active: bool(r.is_active),
    is_locked: bool(r.is_system),
  }),
};

const accountGroupMapping: Mapping = {
  table: "account_groups",
  area: "accounting",
  label: "Account group",
  columns: { id: "id", account_no: "number", name: "name" },
  defaultOrder: "account_no",
  read: (r) => ({
    id: r.id,
    uuid: uuidFor(TAG.account_group, Number(r.id)),
    account_no: String(r.number),
    name: r.name,
    parent_fibu_account_group_id: r.parent_id ?? null,
    is_active: true,
    is_locked: false,
  }),
};

// ------------------------------------------------------------------ company profile

const LEGAL_FORMS: [RegExp, string][] = [
  [/^(ag|sa|corporation)/i, "corporation"],
  [/^(gmbh|s[àa]rl|sagl|llc)/i, "limited_liability_company"],
  [/^(stiftung|fondation|fondazione)/i, "foundation"],
  [/^(verein|association|associazione)/i, "association"],
  [/^(kollektiv|kg|snc|sc)/i, "joint_partnership"],
];

async function companyProfile(ctx: Ctx) {
  const c = await getSettings(ctx, "company");
  let logo: string | null = null;
  if (c.logo_file_id && ctx.files) {
    const file = await ctx.db.first<Row>("SELECT storage_key FROM files WHERE id = ?", c.logo_file_id);
    const object = file ? await ctx.files.get(String(file.storage_key)) : null;
    if (object) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      logo = btoa(s);
    }
  }
  const country = await ctx.db.first<Row>("SELECT id, name FROM countries WHERE upper(code) = upper(?)", c.country_code ?? "CH");
  return {
    id: 1,
    name: c.name || ctx.tenant.name,
    address: c.street ?? null,
    address_nr: c.house_number ?? null,
    postcode: c.postcode ?? null,
    city: c.city ?? null,
    country_id: country?.id ?? null,
    name_short: c.country_code ?? "CH",
    iso3166_alpha2: c.country_code ?? "CH",
    legal_form: LEGAL_FORMS.find(([re]) => re.test(c.legal_form ?? ""))?.[1] ?? "sole_proprietorship",
    country_name: country?.name ?? null,
    mail: c.email ?? null,
    phone_fixed: c.phone ?? null,
    phone_mobile: null,
    fax: null,
    url: c.website ?? null,
    skype_name: null,
    facebook_name: null,
    twitter_name: null,
    description: null,
    ust_id_nr: c.vat_number ?? null,
    mwst_nr: c.vat_number ?? null,
    trade_register_nr: c.commercial_register ?? null,
    has_own_logo: !!logo,
    is_public_profile: false,
    is_logo_public: false,
    is_address_public: false,
    is_phone_public: false,
    is_mobile_public: false,
    is_fax_public: false,
    is_mail_public: false,
    is_url_public: false,
    is_skype_public: false,
    logo_base64: logo,
  };
}

// ------------------------------------------------------------------ routes

export const sectorMapping = nameList("contact_sectors", "Sector");
export const groupMapping = nameList("contact_groups", "Contact group");
export const unitMapping = nameList("units", "Unit", "inventory");
export const salutationMapping = nameList("salutations", "Salutation");
export const titleMapping = nameList("titles", "Title");
const paymentTypeMapping = nameList("payment_types", "Payment type", "sales");
const stockMapping = nameList("stock_locations", "Stock location", "inventory");
const stockAreaMapping = nameList("stock_areas", "Stock area", "inventory");

const staticList = (rows: () => Row[]) => async () => rows();

export function contactRoutes(): Route[] {
  return [
    ...crud("/2.0/contact", "contact_id", contactMapping, ["list", "create", "search", "show", "edit", "delete"]),
    route("POST", "/2.0/contact/_bulk_create", async (c) => {
      const items = Array.isArray(c.body) ? (c.body as Row[]) : [];
      const out: Row[] = [];
      for (const item of items) out.push(await createWire(c.ctx, contactMapping, item ?? {}));
      return out;
    }),
    route("PATCH", "/2.0/contact/{contact_id}/restore", async (c) => {
      await restoreRecord(c.ctx, getResource("contacts")!, pathId(c, "contact_id"));
      return ok;
    }),

    // Additional addresses, nested under the contact.
    route("GET", "/2.0/contact/{contact_id}/additional_address", (c) =>
      listWire(c, addressMapping, { where: ["contact_id = ?"], args: [pathId(c, "contact_id")] }),
    ),
    route("POST", "/2.0/contact/{contact_id}/additional_address", async (c) =>
      created(await createWire(c.ctx, addressMapping, bodyObject(c), { contact_id: pathId(c, "contact_id") })),
    ),
    route("POST", "/2.0/contact/{contact_id}/additional_address/search", (c) =>
      searchWire(c, addressMapping, { where: ["contact_id = ?"], args: [pathId(c, "contact_id")] }),
    ),
    route("GET", "/2.0/contact/{contact_id}/additional_address/{additional_address_id}", async (c) =>
      wire(c.ctx, addressMapping, await nestedRow(c.ctx, addressMapping, pathId(c, "additional_address_id"), pathId(c, "contact_id"))),
    ),
    route("POST", "/2.0/contact/{contact_id}/additional_address/{additional_address_id}", async (c) => {
      await nestedRow(c.ctx, addressMapping, pathId(c, "additional_address_id"), pathId(c, "contact_id"));
      return updateWire(c.ctx, addressMapping, pathId(c, "additional_address_id"), bodyObject(c));
    }),
    route("DELETE", "/2.0/contact/{contact_id}/additional_address/{additional_address_id}", async (c) => {
      await nestedRow(c.ctx, addressMapping, pathId(c, "additional_address_id"), pathId(c, "contact_id"));
      await deleteWire(c.ctx, addressMapping, pathId(c, "additional_address_id"));
      return ok;
    }),

    ...crud("/2.0/contact_relation", "contact_relation_id", relationMapping, ["list", "create", "search", "show", "edit", "delete"]),
    ...crud("/2.0/contact_group", "contact_group_id", groupMapping, ["list", "create", "search", "show", "edit", "delete"]),
    ...crud("/2.0/contact_branch", "contact_branch_id", sectorMapping, ["list", "search"]),
    ...crud("/2.0/salutation", "salutation_id", salutationMapping, ["list", "create", "search", "show", "edit", "delete"]),
    ...crud("/2.0/title", "title_id", titleMapping, ["list", "create", "search", "show", "edit", "delete"]),
    ...crud("/2.0/country", "country_id", countryMapping, ["list", "create", "search", "show", "edit", "delete"]),
    ...crud("/2.0/language", "language_id", languageMapping, ["list", "search"]),
    ...crud("/2.0/unit", "unit_id", unitMapping, ["list", "create", "search", "show", "edit", "delete"]),
    ...crud("/2.0/payment_type", "payment_type_id", paymentTypeMapping, ["list", "search"]),
    ...crud("/2.0/stock", "stock_id", stockMapping, ["list", "search"]),
    ...crud("/2.0/stock_place", "stock_place_id", stockAreaMapping, ["list", "search"]),
    ...crud("/2.0/note", "note_id", noteMapping, ["list", "create", "search", "show", "edit", "delete"]),
    ...crud("/2.0/task", "task_id", taskMapping, ["list", "create", "search", "show", "edit", "delete"]),
    ...crud("/2.0/client_service", "client_service_id", activityMapping, ["list", "create", "search"]),
    ...crud("/2.0/accounts", "account_id", accountMapping, ["list", "search"]),
    ...crud("/2.0/account_groups", "account_group_id", accountGroupMapping, ["list"]),
    route("GET", "/2.0/todo_status", staticList(TODO_STATUS.rows)),
    route("GET", "/2.0/todo_priority", staticList(TODO_PRIORITY.rows)),
    route("GET", "/2.0/communication_kind", staticList(COMMUNICATION_KINDS.rows)),
    route("POST", "/2.0/communication_kind/search", async (c) => filterStatic(COMMUNICATION_KINDS.rows(), c.body)),
    route("GET", "/2.0/company_profile", async (c) => [await companyProfile(c.ctx)]),
    route("GET", "/2.0/company_profile/{profile_id}", async (c) => {
      if (pathId(c, "profile_id") !== 1) throw notFound("Company profile");
      return companyProfile(c.ctx);
    }),
  ];
}

/** A child record that must belong to the given parent. */
async function nestedRow(ctx: Ctx, m: Mapping, id: number, contactId: number): Promise<Row> {
  const rows = await selectRows(ctx, m, { where: ["id = ?", "contact_id = ?"], args: [id, contactId], limit: 1 });
  if (!rows[0]) throw notFound(m.label);
  return rows[0];
}

/** Search over a fixed list (`=` and `like` on any field). */
export function filterStatic(rows: Row[], body: unknown): Row[] {
  const criteria = Array.isArray(body) ? (body as Row[]) : [];
  return rows.filter((row) =>
    criteria.every((c) => {
      const v = String(row[String(c.field)] ?? "").toLowerCase();
      const want = String(c.value ?? "").toLowerCase();
      return c.criteria === "like" ? v.includes(want) : c.criteria === "!=" || c.criteria === "not_equal" ? v !== want : v === want;
    }),
  );
}
