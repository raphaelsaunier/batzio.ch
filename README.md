# Batzio

*Accounting, Sweet!* — Swiss business and accounting software for people with a deep aversion to accounting. It is **agent-first**: drop a bill, paste a screenshot, forward an email or type one sentence, and Batzi (a Claude-powered bookkeeper) books it. Underneath sits everything a Swiss SME needs: contacts, sales (quotes → orders → delivery notes → invoices with QR-bill), purchasing, a complete double-entry ledger with Swiss VAT, banking (camt/pain), projects and time tracking, and payroll — with a REST API, OpenAPI documentation and an MCP server for your own AI agents.

Built with **vinext** (Next.js App Router on Vite) for **Cloudflare Workers**, **shadcn/ui**, and **one Cloudflare D1 database per company** — plus native apps for **iPhone, iPad, Mac and Apple Vision Pro** (one SwiftUI app), **Android** (Jetpack Compose) and **Windows** (WinUI 3), all in this monorepo and all drawn from the same definitions, translations and design tokens.

---

## Features

| Area | What you get |
| --- | --- |
| **Batzi, the agent** | Chat panel everywhere (⌘J) and a console on the Today page. Uses the same toolkit as MCP: create/issue invoices, record bills and receipts (with the original attached), import lists, change company details, VAT rules, document texts, number formats, the logo, invite people. Destructive steps wait for a confirm button. Claude Opus 5.5 with adaptive thinking, streaming progress updates and server-side refusal fallback |
| **Drop anything** | Drag or paste files anywhere: camt statements and clean CSV/XLSX tables (contacts, products, opening balances, bank lines) are imported on the spot; PDFs, photos and screenshots go to Batzi |
| **Inbound email** | Every company gets a private address `<slug>.<token>@<EMAIL_DOMAIN>` (Cloudflare Email Routing → the Worker's `email()`). Suppliers can send bills straight in; mail from authenticated team members may contain instructions; strangers can only add bills/receipts for review |
| **Quick sentences** | “invoice Muster AG 3h consulting at 180”, “paid 42.50 for SBB tickets yesterday”, “2h30 on Website relaunch”, “Anna paid” — parsed deterministically in EN/DE/FR/IT with a live preview, no AI needed |
| **Today** | “Needs you” cards with one-click answers (bank matches, late invoices, bills due, unbilled time, VAT deadline, payroll, missing setup), money weather (8-week cash forecast), the numbers that matter |
| **A4 document editor** | Quotes, orders, invoices, credit notes, delivery notes and purchase orders are edited on a sheet that mirrors the PDF millimetre for millimetre (letterhead, window address, table, totals, real QR-bill); fields appear on hover |
| **Languages & jargon** | UI in English, Deutsch, Français and Italiano (gettext-style catalog with a coverage test); accounting terms carry plain-words tooltips in all four languages; “accountant goggles” switch between simple and classic terminology |
| **Contacts** | Companies and persons, relations, additional addresses, groups, sectors, notes, UID (CHE) validation, archive/restore |
| **Sales** | Quotes, sales orders (with recurring billing), delivery notes, invoices, credit notes; item/free/text/subtotal/discount/page-break positions, optional positions, VAT incl./excl./none, 5-Rappen rounding, conversions between documents, duplication |
| **Invoicing** | Swiss QR-bill (QR-IBAN + QRR, or IBAN + SCOR creditor reference), multilingual PDFs (DE/FR/IT/EN by customer language), payments incl. cash discount (Skonto), partial payments, three-level dunning with fees, bad-debt write-off with VAT correction |
| **Purchasing** | Supplier bills with input VAT per line, purchase orders with goods receipt, expenses (cash/card/private), payment scheduling |
| **Accounting** | Swiss SME chart of accounts (KMU) in 4 languages, automatic bookings for every workflow with exact VAT, manual and compound entries with automatic VAT split, reversals, journal, account ledgers, trial balance, staged income statement (gross profit I/II, EBITDA, EBIT, EBT), balance sheet, business-year closing and period locks |
| **VAT** | 8.1 % / 2.6 % / 3.8 %, exports and exempt supplies, input tax (material vs. investments), VAT return figures by ESTV form digit, settlement booking, VAT periods |
| **Banking** | Bank accounts with IBAN/QR-IBAN, ISO 20022 **camt.052/053/054** and CSV import with de-duplication, auto-matching by QR reference / invoice number / amount, one-click booking; **pain.001.001.09** (Swiss Payment Standards) export |
| **Projects** | Projects with budgets (hours/amount), milestones, work packages, activities with rates, time tracking, tasks, budget burn, one-click invoicing of unbilled time |
| **Payroll** | Employees, absences, monthly payroll runs: AHV/IV/EO, ALV with ceiling, BVG, NBU, KTG, withholding tax, family allowances, employer costs, booked to the ledger, payslip PDFs, annual salary summary |
| **Inventory** | Products and services, units, stock locations/areas, stock movements from deliveries and goods receipts |
| **Reports** | Dashboard KPIs and 12-month trend, open receivables/payables with ageing, liquidity forecast, all statements as **PDF and XLSX** |
| **Platform** | Multi-company (fiduciary-friendly) with roles (owner, admin, accountant, member, viewer), invitations, API keys (read-only or read/write, capped to the creator's role), **hash-chained tamper-evident audit log** for every change from UI, API and MCP, file attachments in R2 |
| **Instant & offline** | Page switches in 10–30 ms: links are prefetched the moment the pointer rests on them, lists render from a local copy, so search, filters and sorting never wait for the network, and the keyboard reaches everything (`g i`, `j`/`k`, `↵`, `/`, `c`, `u`, `?`). Lists and every page already visited keep working offline |
| **Compatibility API** | The REST API Swiss accounting integrations already call (2.0, 3.0 and 4.0 paths, same JSON, same errors), served from Batzio's data at `/api/compat`: point an existing integration at it with a Batzio API key and it keeps working. All 310 documented operations, tested against the published specification |
| **Move in** | *Settings → Move in*: paste an access token from the software you are leaving and click once. Contacts, products, projects and time, quotes, orders and invoices with their payments, supplier bills, expenses and manual bookings arrive with their numbers and states; re-running only adds what is new |
| **Integrations** | REST API for every resource, workflow action and report; generated **OpenAPI 3.1** with interactive reference at `/docs/api`; **MCP** server at `/api/mcp`; XLSX export of every list |

## Apps

| App | Where | Built with | What it covers |
| --- | --- | --- | --- |
| **Web** | `apps/web` | vinext (Next.js App Router) on a Cloudflare Worker | Every screen, the A4 document editor, the REST API, MCP, Batzi and inbound email |
| **API** | `apps/api` | Headless Cloudflare Worker | The same `/api/v1`, `/api/mcp`, `/api/agent`, `/api/drop` and `email()` without the UI, for the native apps and integrations |
| **Apple** | `apps/apple` | SwiftUI, one universal target (iOS, iPadOS, macOS, visionOS) + the `BatzioKit` Swift package | Today, quick sentences, Batzi (inspector on iPad/Mac, its own window on Vision Pro), every module's lists, records, workflow actions and forms with positions and live totals, PDFs, all reports with PDF/Excel, bank import, payroll run, settings, team, API keys; drop files on the window, open/share files to Batzio, scan paper with the camera |
| **Android** | `apps/android` | Kotlin, Jetpack Compose, Navigation 3, Material 3 | The same screens; share sheet target, camera, PDF viewer; drawer on phones, permanent pane on tablets |
| **Windows** | `apps/windows` | WinUI 3 (Windows App SDK) + the cross-platform `Batzio.Core` library | The same screens; drag & drop onto the window, share target and file associations, PDF rendering, Credential Locker |

The native apps are **schema-driven clients**: `GET /api/v1/app/bootstrap` hands them the navigation, every resource definition (fields, actions, child collections), the glossary and the report catalogue — translated, and in plain or accountant wording. Lists, records, forms and reports are rendered from that, so a new field or workflow step on the server shows up in every app without a release. Calculations (document totals, quick sentences, reports) run on the server with the same code as the web and PDFs.

### What is shared, and how

| Shared piece | Source | Web | Apple | Android | Windows |
| --- | --- | --- | --- | --- | --- |
| Swiss logic (VAT, QR-bill, IBAN, payroll, document maths, quick-sentence parser) | `packages/core` | imported | via the API | via the API | via the API |
| Engine (storage, resources, REST, MCP, agent, reports, admin) | `packages/server` | imported | API | API | API |
| Translations EN/DE/FR/IT | `packages/i18n` catalog | `t("…")` | `L("…")` ← `strings.json` | `L("…")` ← `assets/strings.json` | `L("…")` ← embedded `strings.json` |
| Design tokens (colours light/dark, radii, spacing, type scale, neumorphic shadows, metal gradient) | `packages/tokens/tokens.json` | `tokens.css` | `Tokens.swift` | `Tokens.kt` | `Tokens.xaml` (incl. WinUI control colours) |
| Icons | `packages/tokens/icons.json` | lucide | SF Symbols | Material | Segoe Fluent |
| Fonts (Bricolage Grotesque, Inter — OFL) | `packages/tokens/fonts` | Google Fonts | bundled | `res/font` | bundled |
| Brand art (coin, app icons) | `apps/web/public/brand` | as is | asset catalog (+ visionOS layered icon) | adaptive icon, drawables | tiles, splash |

`pnpm gen` regenerates every platform file from those sources (`pnpm brand` re-renders the icons); CI fails when a generated file is stale (`pnpm check:gen`) or a string an app uses is missing a translation. All native strings are keys of the same catalog, so the i18n test covers Swift, Kotlin and C# too.

## Architecture

```
                         apps/web (vinext Worker)                 apps/api (headless Worker)
 browser ──▶ App Router pages · server actions ─┐       ┌─ /api/v1 · /api/mcp · /api/agent · /api/drop · email()
 iOS · iPadOS · macOS · visionOS ───────────────┼──────▶│      (also mounted by apps/web)
 Android · Windows ─────────────────────────────┘       │
            ┌───────────────────────────────────────────┴─────────────────────────────────┐
            │ packages/server: domain services (sales, purchases, accounting, banking,    │
            │ payroll, projects) on the generic CRUD engine · resources · agent · reports │
            │ packages/core: pure Swiss logic   ·   packages/i18n: catalog & glossary     │
            └──────────┬───────────────────────────────┬──────────────────────┬───────────┘
                       │                               │                      │
              D1 "DB" (control plane)       D1 TENANT_DB_001…N (one per company)   R2 FILES
              tenants · users · sessions    contacts · documents · ledger · audit…
              memberships · api_keys
```

### One database per company

* `packages/server/src/config/tenant-databases.ts` declares a **pool of D1 slots** (`TENANT_DB_001…`). each app's `cloudflare.config.ts` turns them into bindings (web and API bind the same databases); `cf` provisions missing databases on deploy and Miniflare simulates them locally.
* Creating a company claims the next free, empty slot, runs the tenant migrations and seeds the chart of accounts, VAT codes and master data (`packages/server/src/tenants.ts`). The runtime discovers slots from the bindings themselves.
* Grow the pool before it runs out with `pnpm db:slots add 20` and deploy.
* When no slot is free and `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_D1_TOKEN` are set, a database is created through the D1 REST API and accessed over HTTP (`packages/server/src/db/d1-http.ts`) until it is moved to a binding.
* Migrations are applied lazily and transactionally per database (`packages/server/src/db/migrate.ts`).

### One definition per entity

Each entity is described once in `packages/server/src/resources/defs/*` (fields, nested collections, workflow actions, hooks, permissions). That definition drives:

* validation (`zod`), persistence and child collections (`packages/server/src/crud.ts`), with the audit entry written **in the same D1 transaction** as the change;
* the REST endpoints (`packages/server/src/api/router.ts`) and the OpenAPI document (`packages/server/src/api/openapi.ts`);
* the MCP tools (`packages/server/src/mcp/server.ts`);
* the generic list, detail and form screens on the web **and in every native app** (via `/api/v1/app/bootstrap`), and the XLSX export.

### Conventions

* Money is stored as integer minor units (Rappen); the API and forms use decimal major units. Report endpoints convert to major units as well.
* Document calculations are pure and shared by server, browser and PDF (`packages/core/src/calc/documents.ts`); the apps get live totals from `POST /api/v1/app/documents/totals`, which runs the same function.
* The audit log is sealed as a SHA-256 hash chain; `GET /api/v1/audit/verify` (or *Audit log → Verify integrity*) recomputes it.

### Instant navigation and offline

* **Local-first lists.** `apps/web/lib/local/store.ts` keeps one TanStack DB collection per company and module, filled from `GET /api/v1/app/records/<resource>?shape=db` (up to 2,000 rows) by TanStack Query and persisted to IndexedDB. `components/resource/local-list.tsx` renders lists with live queries, revalidates on each visit and after each router refresh, and asks the server for nothing on client navigations. Archived views (and `?server=1`) use the server-rendered list; above 2,000 rows the list shows the latest ones and says so.
* **Warm before the click.** `components/local/keyboard.tsx` prefetches the full page payload on hover, focus or pointer-down and loads the list into the local store. The main lists sync in idle time after the first page load. The client router keeps pages for 30 s (`experimental.staleTimes`).
* **Small navigation payloads.** The Worker entry marks RSC requests (`x-batzio-navigation`), so the root layout sends the translation catalog only with the first document. After that, a navigation payload is about 20–40 KB instead of about 130 KB.
* **Offline.** `public/sw.js` serves hashed build assets cache-first, and the catalog, fonts and brand art stale-while-revalidate. Pages go network-first (3 s), falling back to the last copy, then `public/offline.html`. The API and RSC requests go straight to the network. The sign-in page clears the local store and the cached pages (`components/local/forget-local-data.tsx`).
* **Keyboard.** Press `?` anywhere for the shortcut list. `g` + letter goes to a module; on lists, `j`/`k` move, `↵` opens, `/` searches, `c` creates and `u` goes back to the list.

## Getting started

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5173, choose **Start free**, and keep *Fill with demo data* checked to get a company with a year of invoices, bills, bookings, payroll, a bank statement and projects.

Local data lives in `.cloudflare/state` (Miniflare). Delete that folder to start over. The headless API Worker runs with `pnpm dev:api` on port 8788 with its own local data; during development the native apps talk to the web dev server, which serves the identical `/api`.

### Native apps

The apps sign in with email and password against a Batzio server (default `http://localhost:5173`; tap the address on the sign-in screen to change it). Debug builds also accept a session token on launch for automated screenshots (see `AppModel` in each app).

**Apple** — Xcode 26+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
pnpm apple
```

That generates `apps/apple/Batzio.xcodeproj` from `project.yml` and opens it; pick an iPhone, iPad, *My Mac* or Apple Vision Pro destination. `swift test` in `apps/apple/BatzioKit` runs the package tests.

**Android** — Android Studio or JDK 21 with the Android SDK. The emulator reaches your machine's dev server at `10.0.2.2:5173` (the default in debug builds):

```bash
pnpm android
```

**Windows** — Windows 10 1809+ with the .NET 10 SDK (or Visual Studio 2026 with the WinUI workload). Open `apps/windows/Batzio.sln`, or:

```bash
dotnet build apps/windows/Batzio.App/Batzio.App.csproj -p:Platform=x64
```

`dotnet test apps/windows/Batzio.Core.Tests` runs the shared library's tests on any OS.

### Tests

```bash
pnpm test
```

The suite runs the domain layer against an in-memory SQLite D1 adapter: schema/definition consistency, Swiss identifiers and QR-bill payloads, VAT and payroll calculations, the complete demo company (ledger balanced, VAT exact, bank matching, payments, pain.001, year-end closing), audit-chain tamper detection, PDF/XLSX rendering and the OpenAPI document. Set `SAMPLES_DIR=/some/dir` to write the generated PDFs and XLSX files for inspection.

```bash
pnpm typecheck
```

The native apps have their own unit tests (`swift test`, `./gradlew testDebugUnitTest`, `dotnet test`); `.github/workflows/ci.yml` runs all of them and builds every app, including the iOS, macOS and visionOS variants and the WinUI app on Windows.

## Deploying

```bash
npx cf auth login
```

```bash
pnpm deploy
```

This deploys the web app and the headless API Worker. Set `accountId` in `apps/web/cloudflare.config.ts` and `apps/api/cloudflare.config.ts` (or `CLOUDFLARE_ACCOUNT_ID`). The control database, the R2 bucket and all tenant database slots are created on first deploy. Optional secrets: `CLOUDFLARE_D1_TOKEN` (HTTP fallback for tenant databases), `APP_URL`.

* **Domains.** Production is served on `www.batzio.ch` (a custom domain of the `batzio` Worker) and on `batzio.<subdomain>.workers.dev`. The apex `batzio.ch` answers through a proxied placeholder record (`AAAA 100::`) and a zone Redirect Rule that sends it to `https://www.batzio.ch` with a 301, keeping the path and query. The API Worker stays on `batzio-api.<subdomain>.workers.dev`.
* **Demo login.** `DEMO_LOGIN_EMAIL` and `DEMO_LOGIN_PASSWORD` are secrets (locally from `apps/web/.dev.vars`). Upload them with the version: `npx cf deploy --prebuilt --secrets-file <file>` (JSON or .env). The first click on *Open the demo* creates the demo company, which takes about half a minute.
* **Previews.** `pnpm deploy:preview <name>` builds with `isPreview` and deploys a Preview named after the branch (the name is required outside git). Each Preview gets `<name>.batzio.ch` and `<name>-batzio.<subdomain>.workers.dev`. Previews bind their own databases and bucket (`batzio-preview-control`, `batzio-preview-tenant-00x`, `batzio-preview-files`) and never see production data. Preview deploys do not create databases or look them up by name, so the preview database ids are pinned in `apps/web/cloudflare.config.ts`. Secrets are not copied from production: for the demo card on Previews, add both demo secrets once under *Workers → batzio → Settings → Previews Base* (they apply to Previews created afterwards), or for an existing Preview with `npx wrangler preview secret put DEMO_LOGIN_EMAIL --name <name>`.

### Batzi and inbound email

* `ANTHROPIC_API_KEY` (secret) turns on Batzi. Without it, quick sentences, drops of statements/spreadsheets and everything else still work; PDFs and images wait in the inbox for a human.
* `EMAIL_DOMAIN` (e.g. `in.example.ch`): enable Cloudflare Email Routing for that domain and add a catch-all rule that sends mail to the `batzio` Worker. The Worker entries (`apps/web/worker/index.ts`, `apps/api/src/index.ts`) wrap the vinext fetch handler and adds `email()`. Each company's address is shown on Today and under Settings (with a button to issue a new one).
* Sender trust: instructions in an email are only followed when the sender is a member of the company *and* the message passed DMARC (or DKIM + SPF). Everyone else can only get bills and receipts recorded.
* Sending documents (`…/send` in the compatibility API): add a Cloudflare Email Service `send_email` binding named `EMAIL` to the Worker and set `EMAIL_FROM` to an address on a domain onboarded to Email Sending. Without them those calls answer 409 with an explanation.

### Moving in

`IMPORT_SOURCE_URL` pre-fills the API address on *Settings → Move in* (the origin that serves `/2.0`, `/3.0` and `/4.0`). The importer (`packages/server/src/importer.ts`) runs in steps of about eight seconds that the page repeats, keeps a source-id → Batzio-id map in `import_map` (so it never duplicates), and continues Batzio's number sequences after the highest imported number. The token is never stored. To try it locally, import one Batzio company into another: `http://127.0.0.1:5173/api/compat` with a read-only API key of the source company.

## API

Create a key under **Settings → API & MCP**, then:

```bash
curl https://<your-domain>/api/v1/invoices?status=open -H "Authorization: Bearer bz_…"
```

* Interactive reference: `/docs/api` — OpenAPI 3.1 JSON: `/api/v1/openapi.json`
* Lists: `q`, `sort`, `dir`, `limit`, `offset`, field equality filters (`status=open`), ranges (`date_gte=2026-01-01`), `format=xlsx`
* Workflows: `POST /api/v1/invoices/{id}/issue`, `/record_payment`, `/create_reminder`, `POST /api/v1/bills/{id}/book`, …
* Reports: `/api/v1/reports/{balance-sheet|income-statement|trial-balance|vat|ledger|open-items|dashboard}` with `format=pdf|xlsx`
* PDFs: `GET /api/v1/{invoices|quotes|orders|deliveries|credit_notes|purchase_orders|reminders|payslips}/{id}/pdf`

## Compatibility API

Existing integrations change two settings: the base URL becomes `https://<your-domain>/api/compat` (the headless API Worker also answers at its root, e.g. `https://api.<your-domain>/2.0/contact`) and the token becomes a Batzio API key, which is bound to one company. Everything lives in `packages/server/src/compat/`:

* `wire.ts` — conventions: decimal strings, `order_by=name_1_desc`, `[{field, value, criteria}]` searches, `{error_code, message}` errors, page envelopes, and stable UUIDs for the 4.0 endpoints (they carry the integer id, so no extra column).
* `table.ts` — one mapping per wire resource; reads are scoped queries, writes go through the Batzio resource, so validation, numbering, bookings and the audit trail behave exactly as in the app. Wire fields Batzio has no column for (fax, Skype name, …) are kept in `compat_extras` and returned unchanged.
* `v2-*.ts`, `v3.ts`, `v4.ts` — contacts and lists, items, sales documents with positions/comments/payments/reminders/PDFs/conversions/recurrence, projects and time, accounting, banking, currencies, taxes, users, files, purchase orders, bills, outgoing payments, expenses and payroll.

`packages/server/tests/compat.test.ts` covers the main flows. With the published specification saved as `tmp/compat-openapi.json` (git-ignored), its conformance suite also calls every documented operation against demo data (`tests/compat-sweep.ts`) and validates each status code and body against the specification; the few places where the specification contradicts the live behaviour are listed in `SPEC_ERRATA` with a reason.

## Agent & inbox API

* `POST /api/v1/agent` `{ "message": "…", "thread_id"?, "file_ids"? }` — ask Batzi; pending confirmations come back in `pending` and are answered with `{ "confirm": { "tool_use_id", "approve" } }`
* `POST /api/v1/inbox/files` (multipart `files`) — drop files into the inbox
* `POST /api/v1/inbox/email` (`message/rfc822`) — deliver a raw email
* `GET /api/v1/inbox?status=needs_you` — what is waiting
* In the app: `POST /api/agent` streams NDJSON events (text, progress updates, tool outcomes); `POST /api/drop` handles drag & drop

## App API

What Batzio's own apps use (all documented in the OpenAPI under *Account* and *App*):

* `POST /api/v1/auth/login`, `/auth/signup`, `/auth/logout`, `GET|PATCH /auth/me`, `POST /auth/companies` — sessions for apps. The returned token is sent as `Authorization: Bearer …` together with `X-Tenant: <company slug>`.
* `GET /api/v1/app/bootstrap?mode=simple|accountant` — navigation, every resource definition, glossary, report catalogue, quick-sentence examples, inbox address, permissions.
* `GET /app/today` · `POST /app/quick/plan` · `POST /app/quick/run` · `GET /app/threads[/{id}]` · `PATCH /app/inbox/{id}`
* `GET /app/records/{resource}[/{id}|/new]` — lists with reference labels and column totals; a record with labels, available actions, lock reason, related records, attachments and history; starting values for a new one.
* `GET /app/options/{resource}` · `GET /app/items/{id}/defaults` · `GET /app/contacts/{id}/snapshot` · `POST /app/documents/totals` · `GET /app/search`
* `GET /app/reports/{id}` — any report as display-ready tables (`format=xlsx` for Excel).
* `GET /app/settings`, `PATCH /app/settings/{group}`, `PATCH /app/numbering/{key}`, `GET|POST /app/team`, `PATCH|DELETE /app/team/{user}`, `GET|POST /app/api-keys`, `DELETE /app/api-keys/{id}`, `POST /app/inbox-address`

Texts in responses (labels, messages, errors) follow `?locale=` or `Accept-Language`.

## MCP

```bash
claude mcp add --transport http batzio https://<your-domain>/api/mcp --header "Authorization: Bearer bz_…"
```

The MCP server and Batzi share one toolkit (`packages/server/src/agent/toolkit.ts`): `list_resource_types`, `search_records`, `get_record`, `create_record`, `update_record`, `delete_record`, `run_record_action`, `create_invoice`, `create_bill`, `create_expense`, `create_journal_entry`, `log_time`, `import_rows`, `import_spreadsheet`, `import_bank_file`, `attach_file`, `get_settings`, `update_company_settings`, `update_accounting_settings`, `update_document_texts`, `set_company_logo`, `list_number_formats`, `set_number_format`, `invite_member`, the financial reports, `import_bank_statement`, `export_payment_file`, `run_payroll`, `run_recurring_billing`, `remind_overdue_invoices` and `verify_audit_log`. Every call is permission-checked and audited with its source (`MCP`, `agent`, `email`).

## Project layout

```
apps/
  web/                    vinext app: routes, components (shadcn), server actions, Worker entry (+ email)
  api/                    headless API Worker (REST, MCP, agent, drops, email)
  apple/                  project.yml (XcodeGen) · Batzio/ SwiftUI screens · BatzioKit/ Swift package
  android/                Gradle project · app/ (Compose, Navigation 3)
  windows/                Batzio.sln · Batzio.Core/ (+ tests) · Batzio.App/ (WinUI 3)
packages/
  core/                   pure Swiss logic: money, format, calc/, swiss/, quick/parse, permissions
  i18n/                   catalog (EN/DE/FR/IT), glossary, runtime, React bindings, native generator
  tokens/                 tokens.json, icons.json, fonts; generators for CSS, Swift, Kotlin, XAML and app icons
  server/                 data layer, auth, CRUD engine, domain services, resources/, api/, mcp/, agent/,
                          compat/ (compatibility API), importer (moving in), reports, admin, PDF, XLSX,
                          audit · tests/ (Vitest, in-memory D1)
.github/workflows/ci.yml  builds and tests every app
```

## Adding an entity

1. Add the table to a new migration in `packages/server/src/db/migrations/tenant.ts`.
2. Describe it with `defineResource` in `packages/server/src/resources/defs/` and register it in `packages/server/src/resources/registry.ts`.
3. Run `pnpm test` — the schema test checks every field against the table.

The list, form, detail screen (web and every native app), REST endpoints, OpenAPI schema, MCP access, XLSX export and audit trail follow automatically.

## Not yet included

Sending documents by email from the app's own screens (the compatibility API's `send` endpoints already work with Email Service) and email replies from Batzi, changes made while offline (the web app is read-only without a connection), eBill, two-factor authentication, plural forms in translations, translated report PDFs (document PDFs follow the customer's language), Swiss salary certificate (Lohnausweis) and ELM transmission, direct ESTV submission, foreign-currency revaluation, and a scheduled trigger for recurring billing and dunning (both are available as one-click actions and API/MCP operations). In the native apps: offline use, push notifications, home-screen widgets and the A4 sheet editor (documents are edited as forms with live totals and previewed as the real PDF).
