import type { Migration } from "../migrate";

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

/** Columns every business table carries. */
const STAMPS = `
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  created_by TEXT,
  updated_by TEXT`;

/**
 * Tenant schema. Each tenant has its own D1 database containing these tables.
 * Money is stored as INTEGER minor units (Rappen/cents); unit prices and
 * quantities are REAL.
 */
export const tenantMigrations: Migration[] = [
  {
    id: 1,
    name: "init",
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE sequences (
  key TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1,
  reset TEXT NOT NULL DEFAULT 'yearly',
  last_year INTEGER
);

-- ---------------------------------------------------------------- master data
CREATE TABLE countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,${STAMPS}
);

CREATE TABLE languages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,${STAMPS}
);

CREATE TABLE salutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  letter_salutation TEXT,${STAMPS}
);

CREATE TABLE titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,${STAMPS}
);

CREATE TABLE contact_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT,${STAMPS}
);

CREATE TABLE contact_sectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,${STAMPS}
);

CREATE TABLE payment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,${STAMPS}
);

CREATE TABLE payment_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  days INTEGER NOT NULL DEFAULT 30,
  discount_days INTEGER,
  discount_percent REAL,
  text TEXT,${STAMPS}
);

CREATE TABLE units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,${STAMPS}
);

CREATE TABLE currencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  symbol TEXT,
  is_base INTEGER NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 1,
  rounding REAL NOT NULL DEFAULT 0.01,${STAMPS}
);

CREATE TABLE exchange_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency_code TEXT NOT NULL,
  date TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT,${STAMPS},
  UNIQUE (currency_code, date)
);

CREATE TABLE account_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id INTEGER REFERENCES account_groups(id),
  sort INTEGER NOT NULL DEFAULT 0,${STAMPS}
);

CREATE TABLE taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'standard',
  account_id INTEGER,
  vat_form_digit TEXT,
  valid_from TEXT,
  valid_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,${STAMPS}
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  group_id INTEGER REFERENCES account_groups(id),
  default_tax_id INTEGER REFERENCES taxes(id),
  currency_code TEXT,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,${STAMPS}
);

CREATE TABLE business_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at TEXT,
  closing_entry_id INTEGER,${STAMPS}
);

CREATE TABLE vat_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'effective',
  status TEXT NOT NULL DEFAULT 'open',
  submitted_at TEXT,
  settlement_entry_id INTEGER,${STAMPS}
);

CREATE TABLE bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  iban TEXT,
  qr_iban TEXT,
  bic TEXT,
  bank_name TEXT,
  account_id INTEGER REFERENCES accounts(id),
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  qr_reference_prefix TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,${STAMPS}
);

CREATE TABLE stock_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,${STAMPS}
);

CREATE TABLE stock_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id),
  name TEXT NOT NULL,${STAMPS}
);

CREATE TABLE fictional_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firstname TEXT NOT NULL,
  lastname TEXT NOT NULL,
  email TEXT,
  title TEXT,${STAMPS}
);

-- ------------------------------------------------------------------- contacts
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nr TEXT,
  type TEXT NOT NULL DEFAULT 'company',
  name_1 TEXT NOT NULL,
  name_2 TEXT,
  salutation_id INTEGER REFERENCES salutations(id),
  title_id INTEGER REFERENCES titles(id),
  birthday TEXT,
  street TEXT,
  house_number TEXT,
  address_addition TEXT,
  postcode TEXT,
  city TEXT,
  country_code TEXT NOT NULL DEFAULT 'CH',
  email TEXT,
  email_2 TEXT,
  phone TEXT,
  phone_mobile TEXT,
  website TEXT,
  language TEXT NOT NULL DEFAULT 'de',
  group_ids TEXT,
  sector_id INTEGER REFERENCES contact_sectors(id),
  owner_user_id TEXT,
  vat_number TEXT,
  iban TEXT,
  payment_term_id INTEGER REFERENCES payment_terms(id),
  currency_code TEXT,
  discount_percent REAL,
  is_customer INTEGER NOT NULL DEFAULT 1,
  is_supplier INTEGER NOT NULL DEFAULT 0,
  remarks TEXT,
  archived_at TEXT,${STAMPS}
);
CREATE INDEX contacts_name ON contacts(name_1);
CREATE UNIQUE INDEX contacts_nr ON contacts(nr) WHERE nr IS NOT NULL;

CREATE TABLE contact_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  related_contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  description TEXT,${STAMPS}
);

CREATE TABLE additional_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'delivery',
  street TEXT,
  house_number TEXT,
  postcode TEXT,
  city TEXT,
  country_code TEXT NOT NULL DEFAULT 'CH',
  description TEXT,${STAMPS}
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT,
  event_date TEXT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  project_id INTEGER,
  user_id TEXT,${STAMPS}
);

-- ---------------------------------------------------------------- inventory
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nr TEXT,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'product',
  unit_id INTEGER REFERENCES units(id),
  sale_price REAL,
  purchase_price REAL,
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  sales_tax_id INTEGER REFERENCES taxes(id),
  purchase_tax_id INTEGER REFERENCES taxes(id),
  revenue_account_id INTEGER REFERENCES accounts(id),
  expense_account_id INTEGER REFERENCES accounts(id),
  is_stock_tracked INTEGER NOT NULL DEFAULT 0,
  stock_quantity REAL NOT NULL DEFAULT 0,
  stock_minimum REAL,
  stock_location_id INTEGER REFERENCES stock_locations(id),
  stock_area_id INTEGER REFERENCES stock_areas(id),
  supplier_id INTEGER REFERENCES contacts(id),
  ean TEXT,
  weight_kg REAL,
  archived_at TEXT,${STAMPS}
);
CREATE UNIQUE INDEX items_nr ON items(nr) WHERE nr IS NOT NULL;

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  date TEXT NOT NULL,
  quantity REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT 'adjustment',
  document_id INTEGER,
  note TEXT,${STAMPS}
);
CREATE INDEX stock_movements_item ON stock_movements(item_id, date);

-- ------------------------------------------------- sales & purchase documents
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  nr TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  contact_id INTEGER REFERENCES contacts(id),
  contact_person_id INTEGER REFERENCES contacts(id),
  address TEXT,
  delivery_address TEXT,
  responsible_user_id TEXT,
  project_id INTEGER,
  language TEXT NOT NULL DEFAULT 'de',
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  exchange_rate REAL NOT NULL DEFAULT 1,
  vat_mode TEXT NOT NULL DEFAULT 'excl',
  date TEXT NOT NULL,
  due_date TEXT,
  payment_term_id INTEGER REFERENCES payment_terms(id),
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  reference TEXT,
  header TEXT,
  footer TEXT,
  total_net INTEGER NOT NULL DEFAULT 0,
  total_vat INTEGER NOT NULL DEFAULT 0,
  rounding INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  amount_open INTEGER NOT NULL DEFAULT 0,
  qr_reference TEXT,
  source_id INTEGER REFERENCES documents(id),
  repetition TEXT,
  next_run_date TEXT,
  issued_at TEXT,
  sent_at TEXT,
  accepted_at TEXT,
  rejected_at TEXT,
  cancelled_at TEXT,
  paid_at TEXT,
  reminder_level INTEGER NOT NULL DEFAULT 0,
  journal_entry_id INTEGER,
  notes TEXT,${STAMPS}
);
CREATE INDEX documents_kind ON documents(kind, status, date);
CREATE INDEX documents_contact ON documents(contact_id);
CREATE UNIQUE INDEX documents_nr ON documents(kind, nr) WHERE nr IS NOT NULL;

CREATE TABLE document_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'custom',
  item_id INTEGER REFERENCES items(id),
  code TEXT,
  text TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_name TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  tax_id INTEGER REFERENCES taxes(id),
  tax_rate REAL NOT NULL DEFAULT 0,
  account_id INTEGER REFERENCES accounts(id),
  is_optional INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX document_positions_doc ON document_positions(document_id, sort);

CREATE TABLE document_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  payment_type_id INTEGER REFERENCES payment_types(id),
  is_cash_discount INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  bank_transaction_id INTEGER,
  journal_entry_id INTEGER,${STAMPS}
);
CREATE INDEX document_payments_doc ON document_payments(document_id);

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  header TEXT,
  footer TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sent_at TEXT,${STAMPS}
);
CREATE INDEX reminders_doc ON reminders(document_id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  user_name TEXT,${STAMPS}
);
CREATE INDEX comments_doc ON comments(document_id);

-- ------------------------------------------------------------------ purchases
CREATE TABLE bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nr TEXT,
  vendor_nr TEXT,
  contact_id INTEGER REFERENCES contacts(id),
  title TEXT,
  date TEXT NOT NULL,
  due_date TEXT,
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  exchange_rate REAL NOT NULL DEFAULT 1,
  vat_mode TEXT NOT NULL DEFAULT 'incl',
  status TEXT NOT NULL DEFAULT 'draft',
  total_net INTEGER NOT NULL DEFAULT 0,
  total_vat INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  amount_open INTEGER NOT NULL DEFAULT 0,
  iban TEXT,
  qr_reference TEXT,
  payment_message TEXT,
  file_id INTEGER,
  project_id INTEGER,
  journal_entry_id INTEGER,
  booked_at TEXT,
  notes TEXT,${STAMPS}
);
CREATE INDEX bills_status ON bills(status, due_date);
CREATE UNIQUE INDEX bills_nr ON bills(nr) WHERE nr IS NOT NULL;

CREATE TABLE bill_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  text TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  tax_id INTEGER REFERENCES taxes(id),
  tax_rate REAL NOT NULL DEFAULT 0,
  account_id INTEGER REFERENCES accounts(id)
);
CREATE INDEX bill_lines_bill ON bill_lines(bill_id, sort);

CREATE TABLE outgoing_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id),
  execution_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  recipient_name TEXT,
  iban TEXT,
  qr_reference TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  exported_at TEXT,
  paid_at TEXT,
  journal_entry_id INTEGER,${STAMPS}
);
CREATE INDEX outgoing_payments_status ON outgoing_payments(status, execution_date);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nr TEXT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  contact_id INTEGER REFERENCES contacts(id),
  amount INTEGER NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  tax_id INTEGER REFERENCES taxes(id),
  account_id INTEGER REFERENCES accounts(id),
  payment_account_id INTEGER REFERENCES accounts(id),
  project_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  file_id INTEGER,
  journal_entry_id INTEGER,
  notes TEXT,${STAMPS}
);

-- ----------------------------------------------------------------- accounting
CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_nr TEXT,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual',
  source_type TEXT,
  source_id INTEGER,
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  exchange_rate REAL NOT NULL DEFAULT 1,
  total INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  reversal_of_id INTEGER REFERENCES journal_entries(id),
  file_id INTEGER,${STAMPS}
);
CREATE INDEX journal_entries_date ON journal_entries(date);
CREATE INDEX journal_entries_source ON journal_entries(source_type, source_id);

CREATE TABLE journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  debit_account_id INTEGER NOT NULL REFERENCES accounts(id),
  credit_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL,
  tax_id INTEGER REFERENCES taxes(id),
  vat_amount INTEGER,
  description TEXT,
  contact_id INTEGER
);
CREATE INDEX journal_lines_entry ON journal_lines(entry_id);

CREATE TABLE postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_id INTEGER,
  date TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0,
  tax_id INTEGER,
  tax_role TEXT,
  description TEXT,
  contra_account_id INTEGER
);
CREATE INDEX postings_account ON postings(account_id, date);
CREATE INDEX postings_date ON postings(date);
CREATE INDEX postings_tax ON postings(tax_id, date);
CREATE INDEX postings_entry ON postings(entry_id);

-- -------------------------------------------------------------------- banking
CREATE TABLE bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  booking_date TEXT NOT NULL,
  value_date TEXT,
  amount INTEGER NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  counterparty TEXT,
  counterparty_iban TEXT,
  reference TEXT,
  remittance TEXT,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched',
  match_type TEXT,
  match_id INTEGER,
  journal_entry_id INTEGER,
  import_batch TEXT,${STAMPS}
);
CREATE UNIQUE INDEX bank_transactions_ext ON bank_transactions(bank_account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX bank_transactions_status ON bank_transactions(status, booking_date);

-- ----------------------------------------------------------- projects & time
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nr TEXT,
  name TEXT NOT NULL,
  contact_id INTEGER REFERENCES contacts(id),
  contact_person_id INTEGER REFERENCES contacts(id),
  responsible_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  type TEXT NOT NULL DEFAULT 'customer',
  start_date TEXT,
  end_date TEXT,
  budget_type TEXT NOT NULL DEFAULT 'none',
  budget_hours REAL,
  budget_amount INTEGER,
  hourly_rate REAL,
  description TEXT,
  archived_at TEXT,${STAMPS}
);

CREATE TABLE project_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  due_date TEXT,
  description TEXT,
  is_done INTEGER NOT NULL DEFAULT 0,${STAMPS}
);

CREATE TABLE work_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id INTEGER REFERENCES project_milestones(id),
  name TEXT NOT NULL,
  estimated_hours REAL,
  description TEXT,
  is_done INTEGER NOT NULL DEFAULT 0,${STAMPS}
);

CREATE TABLE business_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  hourly_rate REAL,
  is_billable INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER REFERENCES accounts(id),${STAMPS}
);

CREATE TABLE timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  user_name TEXT,
  user_id TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  end_time TEXT,
  description TEXT,
  contact_id INTEGER REFERENCES contacts(id),
  project_id INTEGER REFERENCES projects(id),
  work_package_id INTEGER REFERENCES work_packages(id),
  activity_id INTEGER REFERENCES business_activities(id),
  is_billable INTEGER NOT NULL DEFAULT 1,
  hourly_rate REAL,
  status TEXT NOT NULL DEFAULT 'open',
  document_id INTEGER REFERENCES documents(id),${STAMPS}
);
CREATE INDEX timesheets_project ON timesheets(project_id, date);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  assignee_name TEXT,
  assignee_user_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'todo',
  contact_id INTEGER REFERENCES contacts(id),
  project_id INTEGER REFERENCES projects(id),
  done_at TEXT,${STAMPS}
);
CREATE INDEX tasks_status ON tasks(status, due_date);

-- -------------------------------------------------------------------- payroll
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nr TEXT,
  firstname TEXT NOT NULL,
  lastname TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  birthday TEXT,
  ahv_number TEXT,
  street TEXT,
  house_number TEXT,
  postcode TEXT,
  city TEXT,
  country_code TEXT NOT NULL DEFAULT 'CH',
  iban TEXT,
  job_title TEXT,
  entry_date TEXT,
  exit_date TEXT,
  workload_percent REAL NOT NULL DEFAULT 100,
  salary_type TEXT NOT NULL DEFAULT 'monthly',
  monthly_salary INTEGER NOT NULL DEFAULT 0,
  hourly_rate REAL,
  thirteenth_salary INTEGER NOT NULL DEFAULT 1,
  bvg_rate REAL NOT NULL DEFAULT 0,
  nbu_rate REAL NOT NULL DEFAULT 0,
  ktg_rate REAL NOT NULL DEFAULT 0,
  withholding_tax_rate REAL NOT NULL DEFAULT 0,
  child_allowance INTEGER NOT NULL DEFAULT 0,
  vacation_days REAL NOT NULL DEFAULT 25,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,${STAMPS}
);

CREATE TABLE absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'vacation',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'approved',
  note TEXT,${STAMPS}
);
CREATE INDEX absences_employee ON absences(employee_id, start_date);

CREATE TABLE payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  gross INTEGER NOT NULL DEFAULT 0,
  ahv INTEGER NOT NULL DEFAULT 0,
  alv INTEGER NOT NULL DEFAULT 0,
  bvg INTEGER NOT NULL DEFAULT 0,
  nbu INTEGER NOT NULL DEFAULT 0,
  ktg INTEGER NOT NULL DEFAULT 0,
  withholding_tax INTEGER NOT NULL DEFAULT 0,
  allowances INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL DEFAULT 0,
  employer_cost INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  journal_entry_id INTEGER,${STAMPS},
  UNIQUE (employee_id, year, month)
);

-- ---------------------------------------------------------------------- files
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  description TEXT,${STAMPS}
);
CREATE INDEX files_ref ON files(ref_type, ref_id);

-- ------------------------------------------------------------------ audit log
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT ${NOW},
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  summary TEXT,
  changes TEXT,
  ip TEXT,
  user_agent TEXT,
  hash TEXT
);
CREATE INDEX audit_log_resource ON audit_log(resource, resource_id);
CREATE INDEX audit_log_at ON audit_log(at);
`,
  },
  {
    id: 2,
    name: "agent_inbox",
    sql: `
CREATE TABLE inbox_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'upload',
  kind TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'new',
  title TEXT NOT NULL,
  summary TEXT,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  sender TEXT,
  subject TEXT,
  body TEXT,
  payload TEXT,
  result TEXT,
  error TEXT,
  thread_id TEXT,${STAMPS}
);
CREATE INDEX inbox_items_status ON inbox_items(status, created_at);

CREATE TABLE agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  display TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  created_by TEXT
);
CREATE INDEX agent_messages_thread ON agent_messages(thread_id, id);

ALTER TABLE files ADD COLUMN anthropic_file_id TEXT;
ALTER TABLE files ADD COLUMN sha256 TEXT;
`,
  },
  {
    id: 3,
    name: "compat_api",
    sql: `
-- Fields the compatibility API accepts but Batzio does not model (fax, Skype…),
-- kept per record so they round-trip unchanged.
CREATE TABLE compat_extras (
  kind TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (kind, record_id)
);

-- Moving in from other accounting software: source id → Batzio id, so an
-- interrupted or repeated import never duplicates records.
CREATE TABLE import_map (
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (kind, source_id)
);

-- VAT settings per calendar year.
CREATE TABLE calendar_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL UNIQUE,
  is_vat_subject INTEGER NOT NULL DEFAULT 1,
  is_annual_reporting INTEGER NOT NULL DEFAULT 0,
  vat_accounting_method TEXT NOT NULL DEFAULT 'effective',
  vat_accounting_type TEXT NOT NULL DEFAULT 'agreed',
  default_tax_income_id INTEGER REFERENCES taxes(id),
  default_tax_expense_id INTEGER REFERENCES taxes(id),${STAMPS}
);
`,
  },
];
