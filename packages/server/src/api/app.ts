import { z } from "zod";
import { calculateDocument, type CalcPosition, type VatMode } from "@batzio/core/calc/documents";
import { ROLE_PERMISSIONS, isRole, type Area, type Level } from "@batzio/core/permissions";
import { msg, renderMsg, type Locale, type Msg, type TFunction } from "@batzio/i18n";
import { explain, GLOSSARY } from "@batzio/i18n/glossary";
import { tFor } from "@batzio/i18n/server";
import type { Lang } from "@batzio/core/swiss/chart-of-accounts";
import { inviteToCompany, changeMemberRole, issueApiKey, removeCompanyMember, renewInboxAddress, revokeCompanyApiKey, saveSequence, saveSettingsGroup, settingsForms, SETTINGS_GROUPS, type SettingsGroup } from "../admin";
import { historyEntry, recordHistory, type HistoryEntry } from "../history";
import { scanDuplicates } from "../duplicates";
import {
  acceptInvitation,
  authenticate,
  changePassword,
  createSession,
  createUser,
  deleteSession,
  listApiKeys,
  listInvitations,
  listMembers,
  listMemberships,
  slugify,
  type Membership,
  type UserRow,
} from "../control";
import { availableActions, findRecord, listParamsFrom, listRecords, recordTitle, refLabels, resolveDefault, sumColumns, toApi } from "../crud";
import { canCtx, withProvenance, type Ctx } from "../ctx";
import { contactSnapshot, newDocumentDefaults } from "../document-defaults";
import { ensureInboxToken, inboxAddress } from "../email/inbound";
import { getEnv } from "../env";
import { AppError } from "../errors";
import { formData } from "../forms";
import { familyTabs, buildNavigation } from "../navigation";
import { friendlyFields, friendlyResource, greeting, type UiMode } from "../friendly";
import { globalSearch, itemDefaults, refOptions } from "../lookup";
import { DEFAULT_SEQUENCES, previewNumber, type SequenceRow } from "../numbering";
import { REPORT_CATALOG, reportSheets, reportView } from "../reports";
import { toClientResource } from "../resources/client";
import { getResource, listResources } from "../resources/registry";
import type { ResourceDef, Row } from "../resources/types";
import { roundingStep } from "../sales";
import { createCompany } from "../tenants";
import { buildXlsx, XLSX_MIME } from "../xlsx";
import { requestLocale } from "./locale";
import type { Operation } from "./operations";

/**
 * Endpoints for Batzio's own apps (iOS, iPadOS, macOS, visionOS, Android,
 * Windows). They hand the clients display-ready, translated data so every app
 * renders the same screens from the same definitions as the web.
 */

const PDF_RESOURCES = new Set(["quotes", "orders", "deliveries", "invoices", "credit_notes", "purchase_orders", "reminders", "payslips"]);
const LANGS: Lang[] = ["de", "fr", "it", "en"];

const localeOf = (request: Request, query?: Record<string, unknown>): Locale => requestLocale(request, query?.locale);
const modeOf = (query: Record<string, unknown>): UiMode => (query.mode === "accountant" ? "accountant" : "simple");

/** Where a web path leads inside an app. */
export type AppTarget =
  | { kind: "today" }
  | { kind: "reports"; report?: string }
  | { kind: "resource"; resource: string; id?: number; create?: boolean }
  | { kind: "bank_import" }
  | { kind: "payroll" }
  | { kind: "settings"; section?: "company" | "team" | "api" | "numbering" }
  | { kind: "file"; id: number }
  | { kind: "url"; href: string };

export function targetFor(href: string, slug: string): AppTarget {
  const file = /\/api\/v1\/files\/(\d+)\/download/.exec(href);
  if (file) return { kind: "file", id: Number(file[1]) };
  const base = `/${slug}`;
  if (!href.startsWith(base)) return { kind: "url", href };
  const [path] = href.slice(base.length).split("?");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return { kind: "today" };
  if (parts[0] === "reports") return { kind: "reports", report: parts[1] };
  if (parts[0] === "banking" && parts[1] === "import") return { kind: "bank_import" };
  if (parts[0] === "payroll") return { kind: "payroll" };
  if (parts[0] === "settings" && parts[1] === "import") return { kind: "url", href };
  if (parts[0] === "settings") return { kind: "settings", section: parts[1] === "users" ? "team" : parts[1] === "api" ? "api" : undefined };
  if (getResource(parts[0])) {
    if (parts[1] === "new") return { kind: "resource", resource: parts[0], create: true };
    const id = Number(parts[1]);
    return Number.isInteger(id) && id > 0 ? { kind: "resource", resource: parts[0], id } : { kind: "resource", resource: parts[0] };
  }
  return { kind: "url", href };
}

function companies(memberships: Membership[]) {
  return memberships.map((m) => ({ slug: m.tenant.slug, name: m.tenant.name, role: m.role, locale: m.tenant.locale }));
}

const publicUser = (u: UserRow) => ({ id: u.id, name: u.name, email: u.email, locale: u.locale });

/** A resource described for an app, in the chosen mode and language. */
export function appResource(ctx: Ctx, res: ResourceDef, mode: UiMode, t: TFunction) {
  const f = friendlyResource(res, mode);
  const fields = friendlyFields(res, mode);
  return {
    ...toClientResource({ ...res, label: f.label, labelPlural: f.labelPlural, description: f.description, fields }, t),
    empty: f.empty ? { title: t(f.empty.title), text: t(f.empty.text), mood: f.empty.mood } : null,
    defaultSort: res.defaultSort,
    nav: res.nav || null,
    canWrite: canCtx(ctx, res.area, "write") && !res.readOnly,
    canCreate: canCtx(ctx, res.area, "write") && !res.readOnly && !res.noCreate,
    pdf: PDF_RESOURCES.has(res.name),
  };
}

function renderNudgeMsg(t: TFunction, m: Msg | undefined) {
  return m ? renderMsg(t, m) : undefined;
}

// ------------------------------------------------------------------ account

interface AccountInput {
  request: Request;
  body: Record<string, unknown>;
  params: Record<string, string>;
  control: Ctx["control"];
  user?: UserRow;
  token?: string;
}

export interface AccountOperation {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  description?: string;
  /** "none": public; "user": signed in, no company selected yet. */
  auth: "none" | "user";
  body?: z.ZodType;
  run(input: AccountInput): Promise<unknown>;
}

const meta = (request: Request) => ({
  ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  userAgent: request.headers.get("user-agent") ?? undefined,
});

async function issueSession(control: Ctx["control"], user: UserRow, request: Request) {
  const session = await createSession(control, user.id, meta(request));
  return { token: session.token, expires: session.expires, user: publicUser(user), companies: companies(await listMemberships(control, user.id)) };
}

const language = z.enum(["de", "fr", "it", "en"]).default("de");

export const accountOperations: AccountOperation[] = [
  {
    id: "signIn",
    method: "POST",
    path: "/auth/login",
    summary: "Sign in an app with email and password",
    description: "Returns a session token for `Authorization: Bearer …` plus the companies the person belongs to. Send `X-Tenant: <slug>` with every company request.",
    auth: "none",
    body: z.object({ email: z.string().email(), password: z.string().min(1), invite: z.string().optional() }),
    run: async ({ request, body, control }) => {
      const user = await authenticate(control, String(body.email), String(body.password), meta(request).ip ?? "unknown");
      if (body.invite) await acceptInvitation(control, String(body.invite), user.id);
      return issueSession(control, user, request);
    },
  },
  {
    id: "signUp",
    method: "POST",
    path: "/auth/signup",
    summary: "Create an account (and a first company) from an app",
    auth: "none",
    body: z.object({
      name: z.string().trim().min(1),
      email: z.string().email(),
      password: z.string().min(10),
      company: z.string().trim().optional(),
      language,
      demo: z.boolean().optional(),
      invite: z.string().optional(),
    }),
    run: async ({ request, body, control }) => {
      const locale = requestLocale(request, body.locale);
      const user = await createUser(control, { email: String(body.email), name: String(body.name), password: String(body.password), locale });
      const invited = body.invite ? await acceptInvitation(control, String(body.invite), user.id) : null;
      if (!invited) {
        if (!body.company) throw new AppError("validation", "Please enter your company name.", { company: "Required" });
        await createCompany(getEnv(), control, user, {
          name: String(body.company),
          slug: slugify(String(body.company)),
          language: (LANGS.includes(body.language as Lang) ? body.language : "de") as Lang,
          demo: !!body.demo,
        });
      }
      return issueSession(control, user, request);
    },
  },
  {
    id: "signOut",
    method: "POST",
    path: "/auth/logout",
    summary: "End this app session",
    auth: "user",
    run: async ({ control, token }) => {
      await deleteSession(control, token!);
      return { signedOut: true };
    },
  },
  {
    id: "getMyAccount",
    method: "GET",
    path: "/auth/me",
    summary: "The signed-in person and their companies",
    auth: "user",
    run: async ({ control, user }) => ({ user: publicUser(user!), companies: companies(await listMemberships(control, user!.id)) }),
  },
  {
    id: "updateMyAccount",
    method: "PATCH",
    path: "/auth/me",
    summary: "Change name, language or password",
    auth: "user",
    body: z.object({ name: z.string().trim().min(1).optional(), locale: z.enum(["en", "de", "fr", "it"]).optional(), password: z.object({ current: z.string(), next: z.string() }).optional() }),
    run: async ({ control, user, body }) => {
      if (body.name) await control.run("UPDATE users SET name = ? WHERE id = ?", String(body.name), user!.id);
      if (body.locale) await control.run("UPDATE users SET locale = ? WHERE id = ?", String(body.locale), user!.id);
      const password = body.password as { current: string; next: string } | undefined;
      if (password) await changePassword(control, user!.id, password.current, password.next);
      const fresh = (await control.first<UserRow>("SELECT * FROM users WHERE id = ?", user!.id))!;
      return { user: publicUser(fresh) };
    },
  },
  {
    id: "createCompanyFromApp",
    method: "POST",
    path: "/auth/companies",
    summary: "Create another company",
    auth: "user",
    body: z.object({ name: z.string().trim().min(1), language, demo: z.boolean().optional() }),
    run: async ({ control, user, body }) => {
      const tenant = await createCompany(getEnv(), control, user!, {
        name: String(body.name),
        slug: slugify(String(body.name)),
        language: body.language as Lang,
        demo: !!body.demo,
      });
      return { slug: tenant.slug, name: tenant.name };
    },
  },
];

export function matchAccountOperation(method: string, segments: string[]): { op: AccountOperation; params: Record<string, string> } | null {
  const path = `/${segments.join("/")}`;
  const op = accountOperations.find((o) => o.method === method && o.path === path);
  return op ? { op, params: {} } : null;
}

// ------------------------------------------------------------------ company

const listQuery = z.object({}).passthrough();

export const appOperations: Operation[] = [
  {
    id: "appBootstrap",
    method: "GET",
    path: "/app/bootstrap",
    tag: "App",
    summary: "Everything an app needs to draw its screens",
    description: "Navigation, every resource definition (fields, actions, children), the glossary and the report catalogue, translated (`?locale=`, else Accept-Language) and in plain-language (`mode=simple`) or accountant (`mode=accountant`) wording.",
    rawUnits: true,
    run: async (ctx, { request, query }) => {
      const locale = localeOf(request, query);
      const t = tFor(locale);
      const mode = modeOf(query);
      const slug = ctx.tenant.slug;
      const navigation = buildNavigation(slug, ctx.role, mode).map((section) => ({
        id: section.id,
        label: section.label ? t(section.label) : "",
        icon: section.icon,
        items: section.items
          // Screens only the web has (moving in from other software) stay out of the apps.
          .filter((item) => targetFor(item.href, slug).kind !== "url")
          .map((item) => {
            const target = targetFor(item.href, slug);
            const family = target.kind === "resource" ? familyTabs(slug, ctx.role, mode, target.resource) : null;
            return {
              title: t(item.title),
              icon: item.icon,
              target,
              tabs: family && family.tabs.length > 1 ? family.tabs.map((tab) => ({ title: t(tab.title), target: targetFor(tab.href, slug) })) : [],
            };
          }),
      }));
      const level = (area: Area): Level => (ctx.scope === "read" && ROLE_PERMISSIONS[ctx.role][area] === "write" ? "read" : ROLE_PERMISSIONS[ctx.role][area]);
      const env = getEnv();
      return {
        locale,
        mode,
        user: ctx.user,
        tenant: ctx.tenant,
        role: ctx.role,
        permissions: Object.fromEntries((Object.keys(ROLE_PERMISSIONS[ctx.role]) as Area[]).map((a) => [a, level(a)])),
        navigation,
        resources: listResources()
          .filter((r) => canCtx(ctx, r.area, "read"))
          .map((r) => appResource(ctx, r, mode, t)),
        reports: REPORT_CATALOG.filter((r) => canCtx(ctx, r.area, "read")).map((r) => ({ ...r, title: t(r.title), text: t(r.text) })),
        glossary: Object.fromEntries(Object.keys(GLOSSARY).map((id) => [id, explain(id, locale)])),
        agent: !!env.ANTHROPIC_API_KEY,
        inbox: env.EMAIL_DOMAIN ? inboxAddress({ slug, inbox_token: await ensureInboxToken(ctx.control, ctx.tenant.id) }, env.EMAIL_DOMAIN) : null,
        examples: (await import("../agent/quick")).QUICK_EXAMPLES.map((e) => t(e)),
      };
    },
  },
  {
    id: "appToday",
    method: "GET",
    path: "/app/today",
    tag: "App",
    summary: "The Today screen: money weather, what needs you, the inbox and recent chats",
    rawUnits: true,
    run: async (ctx, { request, query }) => {
      const locale = localeOf(request, query);
      const t = tFor(locale);
      const { getNudges, moneyWeather } = await import("../nudges");
      const { listInbox } = await import("../agent/inbox");
      const { listThreads } = await import("../agent/threads");
      const base = `/${ctx.tenant.slug}`;
      const [nudges, weather, inbox, threads] = await Promise.all([
        getNudges(ctx, base, locale),
        canCtx(ctx, "banking", "read") ? moneyWeather(ctx) : Promise.resolve(null),
        listInbox(ctx, { status: ["new", "processing", "needs_you", "failed"], limit: 30 }),
        listThreads(ctx, 15),
      ]);
      return {
        greeting: greeting(),
        name: ctx.user?.name.split(" ")[0] ?? ctx.actor.name,
        weather: weather && { ...weather, cash: weather.cash / 100, incoming: weather.incoming / 100, outgoing: weather.outgoing / 100, low: { ...weather.low, balance: weather.low.balance / 100 }, weeks: weather.weeks.map((w) => ({ ...w, balance: w.balance / 100 })) },
        nudges: nudges.map((n) => ({
          key: n.key,
          icon: n.icon,
          tone: n.tone,
          title: renderNudgeMsg(t, n.title),
          text: renderNudgeMsg(t, n.text),
          amount: n.amount === undefined ? undefined : n.amount / 100,
          actions: n.actions.map(({ label, prompt, href, ...a }) => ({
            ...a,
            label: renderMsg(t, label),
            prompt: renderNudgeMsg(t, prompt),
            target: href ? targetFor(href, ctx.tenant.slug) : undefined,
          })),
        })),
        inbox,
        threads,
      };
    },
  },
  {
    id: "appQuickPlan",
    method: "POST",
    path: "/app/quick/plan",
    tag: "App",
    summary: "Preview what a quick sentence would do (“invoice Muster AG 3h consulting at 180”)",
    body: z.object({ text: z.string() }),
    rawUnits: true,
    run: async (ctx, { request, body }) => {
      const { planQuick } = await import("../agent/quick");
      const text = String((body as { text: string }).text ?? "");
      if (text.trim().length < 3) return null;
      const plan = await planQuick(ctx, text).catch(() => null);
      if (!plan) return null;
      const t = tFor(localeOf(request));
      return {
        intent: plan.intent,
        headline: renderMsg(t, plan.headline),
        details: plan.details.map((m) => renderMsg(t, m)),
        warnings: plan.warnings.map((m) => renderMsg(t, m)),
        actions: plan.actions.map((a) => ({ ...a, label: renderMsg(t, a.label) })),
        total: plan.total === undefined ? undefined : plan.total / 100,
      };
    },
  },
  {
    id: "appQuickRun",
    method: "POST",
    path: "/app/quick/run",
    tag: "App",
    summary: "Run one of the actions a quick sentence offers",
    body: z.object({ text: z.string(), actionId: z.string() }),
    rawUnits: true,
    run: async (ctx, { request, body }) => {
      const { runQuick } = await import("../agent/quick");
      const b = body as { text: string; actionId: string };
      const outcome = await runQuick(withProvenance(ctx, { sentence: b.text.slice(0, 200) }), b.text, b.actionId);
      return { ...outcome, message: renderMsg(tFor(localeOf(request)), outcome.message) };
    },
  },
  {
    id: "appThreads",
    method: "GET",
    path: "/app/threads",
    tag: "App",
    summary: "Recent conversations with Batzi",
    rawUnits: true,
    run: async (ctx) => {
      const { listThreads } = await import("../agent/threads");
      return listThreads(ctx, 30);
    },
  },
  {
    id: "appThread",
    method: "GET",
    path: "/app/threads/{id}",
    tag: "App",
    summary: "One conversation, turn by turn",
    rawUnits: true,
    run: async (ctx, { params }) => {
      const { loadThread, threadBelongsTo, toUiTurns } = await import("../agent/threads");
      if (!(await threadBelongsTo(ctx, params.id))) throw new AppError("not_found", "Conversation not found.");
      return toUiTurns(await loadThread(ctx, params.id));
    },
  },
  {
    id: "appInboxUpdate",
    method: "PATCH",
    path: "/app/inbox/{id}",
    tag: "App",
    summary: "Mark an inbox item as done",
    body: z.object({ status: z.enum(["done", "new"]) }),
    rawUnits: true,
    run: async (ctx, { params, body }) => {
      const { updateInboxItem } = await import("../agent/inbox");
      await updateInboxItem(ctx, Number(params.id), { status: (body as { status: "done" | "new" }).status });
      return { id: Number(params.id) };
    },
  },
  {
    id: "appRecordList",
    method: "GET",
    path: "/app/records/{resource}",
    tag: "App",
    summary: "A page of records with reference labels and column totals",
    description: "Accepts the same list parameters as `GET /{resource}` (q, sort, dir, limit, offset, filters); `shape=db` returns stored units.",
    query: listQuery,
    rawUnits: true,
    run: async (ctx, { params, query }) => {
      const res = readable(ctx, params.resource);
      const { shape, ...rest } = query as Record<string, string>;
      const listParams = listParamsFrom(rest);
      const page = await listRecords(ctx, res, listParams);
      const money = res.fields.filter((f) => f.list && f.type === "money").map((f) => f.name);
      const totals = money.length ? await sumColumns(ctx, res, listParams, money) : {};
      return {
        // `shape=db` keeps stored units (Rappen, 0/1) for the web's cell renderers.
        rows: shape === "db" ? page.rows : page.rows.map((r) => toApi(res, r)),
        labels: await refLabels(ctx, res, page.rows, getResource),
        titles: Object.fromEntries(page.rows.map((r) => [String(r.id), recordTitle(res, r)])),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / 100])),
      };
    },
  },
  {
    id: "appRecordNew",
    method: "GET",
    path: "/app/records/{resource}/new",
    tag: "App",
    summary: "Starting values for a new record (documents get language, texts, bank account…)",
    rawUnits: true,
    run: async (ctx, { params, query }) => {
      const res = readable(ctx, params.resource);
      const { taxes, rounding } = await formData(ctx, { ...res, view: res.view }, null);
      const contactId = query.contact_id ? Number(query.contact_id) : null;
      const contact = contactId ? await contactSnapshot(ctx, contactId) : null;
      const values: Row = {};
      for (const f of res.fields) if (f.default !== undefined && typeof f.default !== "function") values[f.name] = resolveDefault(f.default);
      if (res.view === "document") Object.assign(values, await newDocumentDefaults(ctx, res, contact), contactId ? { contact_id: contactId } : {});
      return { values, taxes, rounding };
    },
  },
  {
    id: "appRecord",
    method: "GET",
    path: "/app/records/{resource}/{id}",
    tag: "App",
    summary: "One record with labels, available actions, related records, attachments and history",
    rawUnits: true,
    run: async (ctx, { params, request, query }) => {
      const res = readable(ctx, params.resource);
      const id = Number(params.id);
      const record = await findRecord(ctx, res, id);
      if (!record) throw new AppError("not_found", "{label} #{id} not found.", undefined, { label: res.label, id });
      const t = tFor(localeOf(request, query));
      const mode = modeOf(query);
      const { initial, labels, taxes, rounding } = await formData(ctx, res, record);
      const canWrite = canCtx(ctx, res.area, "write");
      const related = await Promise.all(
        (res.related ?? []).map(async (rel) => {
          const relRes = getResource(rel.resource);
          if (!relRes || !canCtx(ctx, relRes.area, "read")) return null;
          const list = await listRecords(ctx, relRes, { filters: { [rel.foreignKey]: String(id) }, limit: 10 });
          return {
            resource: relRes.name,
            label: t(friendlyResource(relRes, mode).labelPlural),
            foreignKey: rel.foreignKey,
            total: list.total,
            rows: list.rows.map((r) => ({ id: Number(r.id), title: recordTitle(relRes, r), status: relRes.statusField ? r[relRes.statusField] : null, values: toApi(relRes, r) })),
          };
        }),
      );
      const history = canCtx(ctx, "audit", "read") ? (await recordHistory(ctx, t, res.name, id, 30)).map(appHistoryEntry) : [];
      const files = await ctx.db.all<{ id: number; name: string; mime_type: string | null; size: number }>(
        "SELECT id, name, mime_type, size FROM files WHERE ref_type = ? AND ref_id = ? ORDER BY id DESC",
        res.name,
        id,
      );
      const lock = res.hooks?.lockReason?.(record) ?? null;
      return {
        record: initial,
        title: recordTitle(res, record),
        labels,
        taxes,
        rounding,
        actions: canWrite ? availableActions(res, record).map((a) => a.name) : [],
        canEdit: canWrite && !res.readOnly && !lock,
        canDelete: canWrite && !res.noDelete && !res.readOnly,
        locked: lock ? t(lock) : null,
        archived: !!record.archived_at,
        pdf: PDF_RESOURCES.has(res.name) ? `/${res.name}/${id}/pdf` : null,
        related: related.filter(Boolean),
        files,
        history,
      };
    },
  },
  {
    id: "appHistory",
    method: "GET",
    path: "/app/history/{resource}/{id}",
    tag: "App",
    summary: "A record's history in words: who changed what (person or software), from where, before and after, and whether it can be undone",
    area: "audit",
    rawUnits: true,
    run: async (ctx, { params, request, query }) => {
      const res = readable(ctx, params.resource);
      return (await recordHistory(ctx, tFor(localeOf(request, query)), res.name, Number(params.id), 100)).map(appHistoryEntry);
    },
  },
  {
    id: "appAuditEntry",
    method: "GET",
    path: "/app/audit/{id}",
    tag: "App",
    summary: "One audit log entry in words, with provenance and the before/after of every field",
    area: "audit",
    rawUnits: true,
    run: async (ctx, { params, request, query }) => appHistoryEntry(await historyEntry(ctx, tFor(localeOf(request, query)), Number(params.id))),
  },
  {
    id: "appScanDuplicates",
    method: "POST",
    path: "/app/duplicates/scan",
    tag: "App",
    summary: "Looks through every contact, supplier bill, expense and file for copies of earlier ones",
    area: "audit",
    level: "write",
    rawUnits: true,
    run: async (ctx, { request }) => {
      const flagged = await scanDuplicates(ctx);
      return { flagged, message: renderMsg(tFor(localeOf(request)), msg("{n} possible duplicates found.", { n: flagged })) };
    },
  },
  {
    id: "appDocumentTotals",
    method: "POST",
    path: "/app/documents/totals",
    tag: "App",
    summary: "Live totals for a document being edited (same maths as saving and the PDF)",
    body: z.object({
      positions: z.array(z.record(z.string(), z.unknown())),
      vat_mode: z.enum(["excl", "incl", "none"]).default("excl"),
      currency_code: z.string().default("CHF"),
    }),
    rawUnits: true,
    run: async (ctx, { body }) => {
      const b = body as { positions: Row[]; vat_mode: VatMode; currency_code: string };
      const rates = new Map((await ctx.db.all<{ id: number; rate: number }>("SELECT id, rate FROM taxes")).map((t) => [t.id, t.rate]));
      const positions: CalcPosition[] = b.positions.map((p) => ({
        type: String(p.type ?? "custom"),
        quantity: Number(p.quantity ?? 0),
        unit_price: Number(p.unit_price ?? 0),
        discount_percent: Number(p.discount_percent ?? 0),
        tax_id: p.tax_id ? Number(p.tax_id) : null,
        tax_rate: p.tax_id ? (rates.get(Number(p.tax_id)) ?? 0) : Number(p.tax_rate ?? 0),
        is_optional: !!p.is_optional,
      }));
      const calc = calculateDocument(positions, b.vat_mode, await roundingStep(ctx, b.currency_code));
      const m = (c: number) => c / 100;
      return {
        lines: calc.lines.map((l) => ({ total: m(l.total), subtotal: l.subtotal === undefined ? undefined : m(l.subtotal) })),
        total_net: m(calc.totalNet),
        total_vat: m(calc.totalVat),
        rounding: m(calc.rounding),
        total: m(calc.total),
        vat: calc.vat.map((v) => ({ rate: v.rate, tax_id: v.taxId, base: m(v.base), vat: m(v.vat), gross: m(v.gross) })),
      };
    },
  },
  {
    id: "appOptions",
    method: "GET",
    path: "/app/options/{resource}",
    tag: "App",
    summary: "Choices for a reference picker",
    description: "`q` searches, `ids=1,2` resolves labels, any other parameter is an equality filter.",
    query: listQuery,
    rawUnits: true,
    run: async (ctx, { params, query }) => {
      const { q, ids, ...rest } = query as Record<string, string>;
      const filter: Record<string, string> = {};
      for (const [k, v] of Object.entries(rest)) if (k !== "tenant" && k !== "locale" && k !== "mode") filter[k] = v;
      return refOptions(ctx, params.resource, q ?? "", filter, ids ? ids.split(",").map(Number).filter(Number.isFinite) : undefined);
    },
  },
  {
    id: "appItemDefaults",
    method: "GET",
    path: "/app/items/{id}/defaults",
    tag: "App",
    summary: "Text, unit, price and VAT a catalogue item brings into a document position",
    rawUnits: true,
    run: async (ctx, { params, query }) => {
      const d = await itemDefaults(ctx, Number(params.id), query.purchase === "1" || query.purchase === "true");
      return d && { ...d, unit_price: d.unit_price / 100 };
    },
  },
  {
    id: "appContactSnapshot",
    method: "GET",
    path: "/app/contacts/{id}/snapshot",
    tag: "App",
    summary: "The address block, language and QR debtor a document prints for a contact",
    rawUnits: true,
    run: async (ctx, { params, query }) => {
      if (!canCtx(ctx, "contacts", "read")) throw new AppError("forbidden", "You do not have access to contacts.");
      return contactSnapshot(ctx, Number(params.id), query.person_id ? Number(query.person_id) : null);
    },
  },
  {
    id: "appSearch",
    method: "GET",
    path: "/app/search",
    tag: "App",
    summary: "Search contacts, documents, products, projects, accounts and people at once",
    query: z.object({ q: z.string() }).passthrough(),
    rawUnits: true,
    run: async (ctx, { request, query }) => {
      const t = tFor(localeOf(request, query));
      return (await globalSearch(ctx, String(query.q ?? ""))).map((h) => ({ ...h, resourceLabel: t(h.resourceLabel) }));
    },
  },
  {
    id: "appReport",
    method: "GET",
    path: "/app/reports/{report}",
    tag: "App",
    summary: "Any report as display-ready tables (`format=xlsx` for Excel)",
    query: z.object({
      date: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      account_id: z.coerce.number().int().optional(),
      account_number: z.string().optional(),
      year: z.coerce.number().int().optional(),
      format: z.enum(["json", "xlsx"]).optional(),
    }).passthrough(),
    formats: ["json", "xlsx"],
    rawUnits: true,
    run: async (ctx, { params, query, request }) => {
      const t = tFor(localeOf(request, query));
      const view = await reportView(
        ctx,
        params.report,
        {
          date: query.date as string | undefined,
          from: query.from as string | undefined,
          to: query.to as string | undefined,
          account_id: query.account_id ? Number(query.account_id) : undefined,
          account_number: query.account_number as string | undefined,
          year: query.year ? Number(query.year) : undefined,
        },
        t,
      );
      if (query.format === "xlsx") {
        return new Response(buildXlsx(reportSheets(view, ctx.tenant.name)) as BodyInit, {
          headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${params.report}.xlsx"`, "Cache-Control": "private, no-store" },
        });
      }
      return view;
    },
  },
  {
    id: "appSettings",
    method: "GET",
    path: "/app/settings",
    tag: "App",
    summary: "Settings forms with current values, number formats and the inbox address",
    area: "settings",
    level: "read",
    rawUnits: true,
    run: async (ctx, { request, query }) => {
      const t = tFor(localeOf(request, query));
      const sequences = await ctx.db.all<SequenceRow>("SELECT * FROM sequences");
      const env = getEnv();
      return {
        forms: await settingsForms(ctx, t),
        numbering: await Promise.all(
          DEFAULT_SEQUENCES.map(async (d) => {
            const row = sequences.find((s) => s.key === d.key);
            return { key: d.key, label: t(d.label), format: row?.format ?? d.format, next_value: row?.next_value ?? d.start ?? 1, preview: await previewNumber(ctx, d.key) };
          }),
        ),
        inbox: env.EMAIL_DOMAIN ? inboxAddress({ slug: ctx.tenant.slug, inbox_token: await ensureInboxToken(ctx.control, ctx.tenant.id) }, env.EMAIL_DOMAIN) : null,
        agent: !!env.ANTHROPIC_API_KEY,
        canWrite: canCtx(ctx, "settings", "write"),
      };
    },
  },
  {
    id: "appSaveSettings",
    method: "PATCH",
    path: "/app/settings/{group}",
    tag: "App",
    summary: "Save one settings form (company, accounting or texts)",
    body: z.record(z.string(), z.unknown()),
    rawUnits: true,
    run: async (ctx, { params, body, request }) => {
      if (!SETTINGS_GROUPS.includes(params.group as SettingsGroup)) throw new AppError("not_found", "Unknown settings group.");
      await saveSettingsGroup(ctx, params.group as SettingsGroup, body as Row);
      return { message: tFor(localeOf(request))("Settings saved.") };
    },
  },
  {
    id: "appSaveNumbering",
    method: "PATCH",
    path: "/app/numbering/{key}",
    tag: "App",
    summary: "Change a document number format",
    body: z.object({ format: z.string(), next_value: z.number().int().min(1) }),
    rawUnits: true,
    run: async (ctx, { params, body, request }) => {
      const b = body as { format: string; next_value: number };
      const nr = await saveSequence(ctx, params.key, b.format, b.next_value);
      return { preview: nr, message: tFor(localeOf(request))("Next number: {nr}", { nr }) };
    },
  },
  {
    id: "appTeam",
    method: "GET",
    path: "/app/team",
    tag: "App",
    summary: "Members and open invitations",
    area: "users",
    level: "read",
    rawUnits: true,
    run: async (ctx) => ({
      members: await listMembers(ctx.control, ctx.tenant.id),
      invitations: await listInvitations(ctx.control, ctx.tenant.id),
      me: ctx.user?.id ?? null,
      canWrite: canCtx(ctx, "users", "write"),
    }),
  },
  {
    id: "appInvite",
    method: "POST",
    path: "/app/team",
    tag: "App",
    summary: "Invite someone (or add an existing user) with a role",
    body: z.object({ email: z.string(), role: z.string() }),
    rawUnits: true,
    run: async (ctx, { body, request }) => {
      const b = body as { email: string; role: string };
      const t = tFor(localeOf(request));
      const r = await inviteToCompany(ctx, b.email, b.role);
      const origin = getEnv().APP_URL ?? new URL(request.url).origin;
      return r.added
        ? { added: true, message: t("{email} was added to the company.", { email: b.email }) }
        : { added: false, link: `${origin}/signup?invite=${r.token}`, message: t("Invitation created. Share the link with your colleague.") };
    },
  },
  {
    id: "appSetRole",
    method: "PATCH",
    path: "/app/team/{userId}",
    tag: "App",
    summary: "Change a member's role",
    body: z.object({ role: z.string() }),
    rawUnits: true,
    run: async (ctx, { params, body }) => {
      const role = (body as { role: string }).role;
      if (!isRole(role)) throw new AppError("validation", "Unknown role.");
      await changeMemberRole(ctx, params.userId, role);
      return { userId: params.userId, role };
    },
  },
  {
    id: "appRemoveMember",
    method: "DELETE",
    path: "/app/team/{userId}",
    tag: "App",
    summary: "Remove a member from the company",
    rawUnits: true,
    run: async (ctx, { params }) => {
      await removeCompanyMember(ctx, params.userId);
      return { userId: params.userId, removed: true };
    },
  },
  {
    id: "appApiKeys",
    method: "GET",
    path: "/app/api-keys",
    tag: "App",
    summary: "API keys of this company (secrets are never shown again)",
    area: "settings",
    level: "read",
    rawUnits: true,
    run: async (ctx) =>
      (await listApiKeys(ctx.control, ctx.tenant.id)).map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scope: k.scope,
        role: k.role,
        user_name: k.user_name,
        last_used_at: k.last_used_at,
        expires_at: k.expires_at,
        revoked_at: k.revoked_at,
        created_at: k.created_at,
      })),
  },
  {
    id: "appCreateApiKey",
    method: "POST",
    path: "/app/api-keys",
    tag: "App",
    summary: "Create an API key for scripts and AI assistants (MCP)",
    body: z.object({ name: z.string(), scope: z.enum(["read", "write"]), role: z.string() }),
    rawUnits: true,
    run: async (ctx, { body, request }) => {
      const b = body as { name: string; scope: "read" | "write"; role: string };
      const { key, record } = await issueApiKey(ctx, b.name, b.scope, b.role);
      return { key, id: record.id, message: tFor(localeOf(request))("API key created. Copy it now — it will not be shown again.") };
    },
  },
  {
    id: "appRevokeApiKey",
    method: "DELETE",
    path: "/app/api-keys/{id}",
    tag: "App",
    summary: "Revoke an API key",
    rawUnits: true,
    run: async (ctx, { params }) => {
      await revokeCompanyApiKey(ctx, params.id);
      return { id: params.id, revoked: true };
    },
  },
  {
    id: "appRenewInbox",
    method: "POST",
    path: "/app/inbox-address",
    tag: "App",
    summary: "Issue a new secret inbox address (the old one stops working)",
    rawUnits: true,
    run: async (ctx) => ({ address: await renewInboxAddress(ctx) }),
  },
];

function readable(ctx: Ctx, name: string): ResourceDef {
  const res = getResource(name);
  if (!res || !canCtx(ctx, res.area, "read")) throw new AppError("not_found", "Unknown resource {name}.", undefined, { name });
  return res;
}

/** History entries for the apps: the described entry plus the flat fields older app versions read. */
function appHistoryEntry(e: HistoryEntry) {
  return { ...e, actor_name: e.actor.name, source: e.actor.source, summary: e.summary ?? e.title };
}
