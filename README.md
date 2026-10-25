# Batzio

*Accounting, Sweet!* — Swiss business and accounting software for people with a deep aversion to accounting. It is **agent-first**: drop a bill, paste a screenshot, forward an email or type one sentence, and Batzi (a Claude-powered bookkeeper) books it. Underneath sits everything a Swiss SME needs: contacts, sales (quotes → orders → delivery notes → invoices with QR-bill), purchasing, a complete double-entry ledger with Swiss VAT, banking (camt/pain), projects and time tracking, and payroll — with a REST API, OpenAPI documentation and an MCP server for your own AI agents.

Built with **vinext** (Next.js App Router on Vite) for **Cloudflare Workers**, **shadcn/ui**, and **one Cloudflare D1 database per company**.

---

## Features

| Area | What you get |
| --- | --- |
| **Batzi, the agent** | Chat panel everywhere (⌘J) and a console on the Today page. Uses the same toolkit as MCP: create/issue invoices, record bills and receipts (with the original attached), import lists, change company details, VAT rules, document texts, number formats, the logo, invite people. Destructive steps wait for a confirm button. Claude Opus 5.5 with adaptive thinking, streaming progress updates and server-side refusal fallback |
| **Drop anything** | Drag or paste files anywhere: camt statements and clean CSV/XLSX tables (contacts, products, opening balances, bank lines) are imported on the spot; PDFs, photos and screenshots go to Batzi |
| **Inbound email** | Every company gets a private address `<slug>.<token>@<EMAIL_DOMAIN>` (Cloudflare Email Routing → `worker/index.ts`). Suppliers can send bills straight in; mail from authenticated team members may contain instructions; strangers can only add bills/receipts for review |
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
| **Integrations** | REST API for every resource, workflow action and report; generated **OpenAPI 3.1** with interactive reference at `/docs/api`; **MCP** server at `/api/mcp`; XLSX export of every list |

## Architecture

```
            ┌──────────────────────── Cloudflare Worker (vinext) ─────────────────────────┐
 browser ──▶│ App Router pages (RSC) · server actions · /api/v1 REST · /api/mcp · /docs/api │
            │                         │                                                     │
            │            lib/server/* domain services (sales, purchases, accounting,      │
            │            banking, payroll, projects) on top of the generic CRUD engine    │
            └──────────┬───────────────────────────────┬──────────────────────┬───────────┘
                       │                               │                      │
              D1 "DB" (control plane)       D1 TENANT_DB_001…N (one per company)   R2 FILES
              tenants · users · sessions    contacts · documents · ledger · audit…
              memberships · api_keys
```

### One database per company

* `config/tenant-databases.ts` declares a **pool of D1 slots** (`TENANT_DB_001…`). `cloudflare.config.ts` turns them into bindings; `cf` provisions missing databases on deploy and Miniflare simulates them locally.
* Creating a company claims the next free, empty slot, runs the tenant migrations and seeds the chart of accounts, VAT codes and master data (`lib/server/tenants.ts`). The runtime discovers slots from the bindings themselves.
* Grow the pool before it runs out with `pnpm db:slots add 20` and deploy.
* When no slot is free and `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_D1_TOKEN` are set, a database is created through the D1 REST API and accessed over HTTP (`lib/server/db/d1-http.ts`) until it is moved to a binding.
* Migrations are applied lazily and transactionally per database (`lib/server/db/migrate.ts`).

### One definition per entity

Each entity is described once in `lib/resources/defs/*` (fields, nested collections, workflow actions, hooks, permissions). That definition drives:

* validation (`zod`), persistence and child collections (`lib/server/crud.ts`), with the audit entry written **in the same D1 transaction** as the change;
* the REST endpoints (`lib/api/router.ts`) and the OpenAPI document (`lib/api/openapi.ts`);
* the MCP tools (`lib/mcp/server.ts`);
* the generic list, detail and form screens and the XLSX export.

### Conventions

* Money is stored as integer minor units (Rappen); the API and forms use decimal major units. Report endpoints convert to major units as well.
* Document calculations are pure and shared by server, browser and PDF (`lib/calc/documents.ts`).
* The audit log is sealed as a SHA-256 hash chain; `GET /api/v1/audit/verify` (or *Audit log → Verify integrity*) recomputes it.

## Getting started

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5173, choose **Start free**, and keep *Fill with demo data* checked to get a company with a year of invoices, bills, bookings, payroll, a bank statement and projects.

Local data lives in `.cloudflare/state` (Miniflare). Delete that folder to start over.

### Tests

```bash
pnpm test
```

The suite runs the domain layer against an in-memory SQLite D1 adapter: schema/definition consistency, Swiss identifiers and QR-bill payloads, VAT and payroll calculations, the complete demo company (ledger balanced, VAT exact, bank matching, payments, pain.001, year-end closing), audit-chain tamper detection, PDF/XLSX rendering and the OpenAPI document. Set `SAMPLES_DIR=/some/dir` to write the generated PDFs and XLSX files for inspection.

```bash
pnpm typecheck
```

## Deploying

```bash
npx cf auth login
```

```bash
pnpm deploy
```

Set `accountId` in `cloudflare.config.ts` (or `CLOUDFLARE_ACCOUNT_ID`). The control database, the R2 bucket and all tenant database slots are created on first deploy. Optional secrets: `CLOUDFLARE_D1_TOKEN` (HTTP fallback for tenant databases), `APP_URL`.

### Batzi and inbound email

* `ANTHROPIC_API_KEY` (secret) turns on Batzi. Without it, quick sentences, drops of statements/spreadsheets and everything else still work; PDFs and images wait in the inbox for a human.
* `EMAIL_DOMAIN` (e.g. `in.example.ch`): enable Cloudflare Email Routing for that domain and add a catch-all rule that sends mail to the `batzio` Worker. The Worker entry `worker/index.ts` wraps the vinext fetch handler and adds `email()`. Each company's address is shown on Today and under Settings (with a button to issue a new one).
* Sender trust: instructions in an email are only followed when the sender is a member of the company *and* the message passed DMARC (or DKIM + SPF). Everyone else can only get bills and receipts recorded.

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

## Agent & inbox API

* `POST /api/v1/agent` `{ "message": "…", "thread_id"?, "file_ids"? }` — ask Batzi; pending confirmations come back in `pending` and are answered with `{ "confirm": { "tool_use_id", "approve" } }`
* `POST /api/v1/inbox/files` (multipart `files`) — drop files into the inbox
* `POST /api/v1/inbox/email` (`message/rfc822`) — deliver a raw email
* `GET /api/v1/inbox?status=needs_you` — what is waiting
* In the app: `POST /api/agent` streams NDJSON events (text, progress updates, tool outcomes); `POST /api/drop` handles drag & drop

## MCP

```bash
claude mcp add --transport http batzio https://<your-domain>/api/mcp --header "Authorization: Bearer bz_…"
```

The MCP server and Batzi share one toolkit (`lib/agent/toolkit.ts`): `list_resource_types`, `search_records`, `get_record`, `create_record`, `update_record`, `delete_record`, `run_record_action`, `create_invoice`, `create_bill`, `create_expense`, `create_journal_entry`, `log_time`, `import_rows`, `import_spreadsheet`, `import_bank_file`, `attach_file`, `get_settings`, `update_company_settings`, `update_accounting_settings`, `update_document_texts`, `set_company_logo`, `list_number_formats`, `set_number_format`, `invite_member`, the financial reports, `import_bank_statement`, `export_payment_file`, `run_payroll`, `run_recurring_billing`, `remind_overdue_invoices` and `verify_audit_log`. Every call is permission-checked and audited with its source (`MCP`, `agent`, `email`).

## Project layout

```
app/                      routes: landing, auth, /[tenant]/… screens, /api/v1, /api/mcp, /docs/api
components/               shell (sidebar, command menu), generic resource UI, reports, settings, ui/ (shadcn)
config/tenant-databases.ts  D1 slot pool
lib/calc/                 pure calculations (documents, payroll)
lib/swiss/                IBAN/QR-IBAN, QR & creditor references, QR-bill payload, UID/AHV, VAT, KMU chart
lib/resources/            resource definitions and registry
lib/server/               data layer, auth, CRUD engine, domain services, PDF, XLSX, audit
lib/api/, lib/mcp/        REST router, OpenAPI generator, operations, MCP server
lib/agent/                toolkit, Claude runtime, threads, inbox, spreadsheet import, quick sentences
lib/i18n/                 locales, catalog (EN/DE/FR/IT), glossary of accounting terms
components/batzi/         agent panel, composer, drop overlay
components/document/      A4 document editor and QR-bill slip
worker/index.ts           Worker entry: vinext fetch handler + email()
tests/                    Vitest suite with an in-memory D1 adapter
```

## Adding an entity

1. Add the table to a new migration in `lib/server/db/migrations/tenant.ts`.
2. Describe it with `defineResource` in `lib/resources/defs/` and register it in `lib/resources/registry.ts`.
3. Run `pnpm test` — the schema test checks every field against the table.

The list, form, detail screen, REST endpoints, OpenAPI schema, MCP access, XLSX export and audit trail follow automatically.

## Not yet included

E-mail delivery of documents and email replies from Batzi, eBill, two-factor authentication, plural forms in translations, translated report PDFs (document PDFs follow the customer's language), Swiss salary certificate (Lohnausweis) and ELM transmission, direct ESTV submission, foreign-currency revaluation, and a scheduled trigger for recurring billing and dunning (both are available as one-click actions and API/MCP operations).
