-- ============================================================================
-- SEED GODOWN & PROCESSING ERP (ARCO) — FINANCE / PAYROLL / AUTH SCHEMA
-- Apply AFTER supabase/schema.sql. This file never edits schema.sql.
--
-- Conventions (see SETUP.md for the full posting rules):
-- * Draft -> posted -> reversed only. Posted rows are never deleted;
--   a reversal inserts compensating ledger rows and marks the header
--   `reversed` with a mandatory reason.
-- * party_ledger.running_balance is RECEIVABLE-POSITIVE: > 0 means the
--   party owes the business, < 0 means the business owes the party
--   (a vendor payable). debit = positive delta, credit = -negative delta.
-- * Opening balances are recorded ONCE in the masters (parties.opening_
--   balance, cash_accounts.opening_balance) and evidenced by an
--   opening_balances row. Reports read masters + ledger history and
--   must NOT add opening_balances again, or openings double-count.
-- * Bag purchases are never counted as packaging expense in P&L.
--   Packaging cost in P&L is consumed-bag cost only (bardana_ledger
--   consumption rows carrying unit_cost), never purchase + consumption.
-- * RLS is enabled on every NEW table below with authenticated-user
--   policies. Server-side role checks in app/actions/* are the real
--   enforcement point; RLS is defence in depth. Pre-existing tables
--   from schema.sql are deliberately NOT altered for RLS here, so the
--   core modules keep working unchanged (see SETUP.md §RLS).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------- Roles
DO $$ BEGIN
  CREATE TYPE app_role_enum AS ENUM (
    'owner_admin', 'storekeeper', 'production_operator', 'gate_operator',
    'accountant', 'hr_payroll', 'read_only_manager'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_status_enum AS ENUM (
    'draft', 'approved', 'partially_paid', 'paid', 'reversed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE settlement_enum AS ENUM ('paid', 'credit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------- Profiles
-- One row per Supabase Auth user. The seed Owner/Admin is created by the
-- operator in Supabase Auth first, then linked here (see SETUP.md) —
-- auth.users ids are never invented in SQL.
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role_enum NOT NULL DEFAULT 'read_only_manager',
  display_name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ---------------------------------------------------------------- Cash accounts
-- Canonical cash/bank accounts for the daybook. cash_ledger.account
-- ('cash'|'bank'|'online') is the legacy kind column; cash_account_id
-- (added below) is the precise account a row belongs to.
CREATE TABLE IF NOT EXISTS cash_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  account_kind TEXT NOT NULL CHECK (account_kind IN ('cash', 'bank', 'online')),
  opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extend the pre-existing cash_ledger (from schema.sql) without
-- redefining it: precise account + settlement kind + actor.
ALTER TABLE cash_ledger ADD COLUMN IF NOT EXISTS cash_account_id UUID REFERENCES cash_accounts(id) ON DELETE SET NULL;
ALTER TABLE cash_ledger ADD COLUMN IF NOT EXISTS settlement_kind TEXT;
ALTER TABLE cash_ledger ADD COLUMN IF NOT EXISTS created_by UUID;
CREATE INDEX IF NOT EXISTS idx_cash_ledger_account_id ON cash_ledger(cash_account_id);

-- ---------------------------------------------------------------- Configurable settings (client-confirmation items)
-- Key/value store for rules the client spec says must NOT be hard-coded:
-- payroll_rules (weekly off, half-day factor, paid/unpaid leave, monthly
-- proration mode), pl_config (COGS valuation basis, packaging-cost model),
-- business_model ('own_seed' | 'customer_owned' | 'both' — spec §15.2).
-- Server actions read these at run time; the seeded values below are
-- PLACEHOLDERS pending client/accountant sign-off, not approved policy.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_settings (key, value) VALUES
  ('payroll_rules', '{"weekly_off_days": [], "weekly_off_paid": false, "half_day_factor": 0.5, "leave_paid": false, "holiday_paid": true, "monthly_mode": "fixed", "proration_denominator": "calendar", "overtime_rate_per_hour": null}'::jsonb),
  ('pl_config', '{"cogs_basis": "UNCONFIRMED — accountant must approve valuation method; do not use purchases as COGS", "packaging_cost_model": "consumed_bag_cost_only", "payroll_in_pl": "separate_line"}'::jsonb),
  ('business_model', '{"model": "UNCONFIRMED — spec §15.2: own_seed | customer_owned | both"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- Expense categories
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  is_operating BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extend pre-existing expenses (from schema.sql) for credit/payable
-- handling. Existing columns (expense_no, category_name, payee, amount,
-- payment_method cash|bank, description, status) are untouched.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES parties(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cash_account_id UUID REFERENCES cash_accounts(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS settlement settlement_enum NOT NULL DEFAULT 'paid';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS client_token TEXT UNIQUE;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_by UUID;
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);

-- ---------------------------------------------------------------- Purchases
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vendor_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  invoice_ref TEXT,
  godown_id UUID REFERENCES godowns(id) ON DELETE SET NULL,
  -- 'received'  = goods physically received: posting moves stock/bardana.
  -- 'bill_only' = vendor bill without receipt: posting creates the
  -- payable only, no stock/bardana movement (spec §10.1).
  receipt_status TEXT NOT NULL DEFAULT 'received' CHECK (receipt_status IN ('received', 'bill_only')),
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  client_token TEXT UNIQUE,
  posted_client_token TEXT,
  notes TEXT,
  created_by UUID,
  posted_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON purchases(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);

CREATE TABLE IF NOT EXISTS purchase_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  packaging_type_id UUID REFERENCES packaging_types(id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL CHECK (item_type IN ('seed', 'packaging')),
  quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  bags_count INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  CHECK ((item_type = 'seed' AND product_id IS NOT NULL)
      OR (item_type = 'packaging' AND packaging_type_id IS NOT NULL))
);

-- Purchase returns / credit notes, always linked to the original.
CREATE TABLE IF NOT EXISTS purchase_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_no TEXT UNIQUE NOT NULL,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  client_token TEXT UNIQUE,
  created_by UUID,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns(purchase_id);
CREATE TABLE IF NOT EXISTS purchase_return_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  purchase_item_id UUID REFERENCES purchase_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- Customer invoices & receipts
CREATE TABLE IF NOT EXISTS customer_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('machinery_job', 'packing', 'sale', 'manual')),
  source_id TEXT,
  source_ref TEXT,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  client_token TEXT UNIQUE,
  notes TEXT,
  created_by UUID,
  posted_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON customer_invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON customer_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON customer_invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_source ON customer_invoices(source_type, source_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  source_type TEXT,
  source_id TEXT
);

CREATE TABLE IF NOT EXISTS customer_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  cash_account_id UUID REFERENCES cash_accounts(id) ON DELETE SET NULL,
  account TEXT NOT NULL CHECK (account IN ('cash', 'bank', 'online')),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  unapplied_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  reference_no TEXT,
  notes TEXT,
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  client_token TEXT UNIQUE,
  created_by UUID,
  posted_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON customer_receipts(date);
CREATE INDEX IF NOT EXISTS idx_receipts_customer ON customer_receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON customer_receipts(status);

-- Explicit allocations only: a receipt never blanket-allocates.
CREATE TABLE IF NOT EXISTS invoice_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL REFERENCES customer_receipts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (receipt_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_alloc_invoice ON invoice_allocations(invoice_id);

-- ---------------------------------------------------------------- Vendor / settlement payments
-- One payment, explicitly allocated. settlement_kind keeps purchase
-- settlement, payroll settlement and expense payments distinct (§12.2):
-- they are never all lumped into "operating expense".
CREATE TABLE IF NOT EXISTS vendor_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vendor_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  cash_account_id UUID REFERENCES cash_accounts(id) ON DELETE SET NULL,
  account TEXT NOT NULL CHECK (account IN ('cash', 'bank', 'online')),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  settlement_kind TEXT NOT NULL DEFAULT 'purchase'
    CHECK (settlement_kind IN ('purchase', 'expense', 'payroll', 'other')),
  reference_no TEXT,
  notes TEXT,
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  client_token TEXT UNIQUE,
  created_by UUID,
  posted_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_date ON vendor_payments(date);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor ON vendor_payments(vendor_id);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES vendor_payments(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('purchase', 'expense', 'payroll')),
  target_id UUID NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, target_type, target_id)
);

-- Internal transfers: two cash_ledger rows, one transfer_no, never
-- revenue or expense.
CREATE TABLE IF NOT EXISTS cash_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_account_id UUID NOT NULL REFERENCES cash_accounts(id) ON DELETE RESTRICT,
  to_account_id UUID NOT NULL REFERENCES cash_accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  reference_no TEXT,
  notes TEXT,
  client_token TEXT UNIQUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_account_id <> to_account_id)
);

-- ---------------------------------------------------------------- Party ledger (single-ledger rule)
CREATE TABLE IF NOT EXISTS party_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'opening', 'purchase', 'purchase_return', 'invoice', 'receipt',
    'payment', 'expense_credit', 'expense_payment', 'payroll', 'adjustment', 'reversal')),
  voucher_type TEXT NOT NULL,
  voucher_id TEXT NOT NULL,
  voucher_no TEXT NOT NULL,
  debit NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit NUMERIC(15,2) NOT NULL DEFAULT 0,
  running_balance NUMERIC(15,2) NOT NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_party_ledger_party_date ON party_ledger(party_id, date);
CREATE INDEX IF NOT EXISTS idx_party_ledger_voucher ON party_ledger(voucher_no);

-- ---------------------------------------------------------------- Bardana ledger
CREATE TABLE IF NOT EXISTS bardana_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  packaging_type_id UUID NOT NULL REFERENCES packaging_types(id) ON DELETE RESTRICT,
  godown_id UUID REFERENCES godowns(id) ON DELETE SET NULL,
  voucher_type TEXT NOT NULL,
  voucher_id TEXT NOT NULL,
  voucher_no TEXT NOT NULL,
  in_qty INTEGER NOT NULL DEFAULT 0,
  out_qty INTEGER NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12,2),
  total_cost NUMERIC(15,2),
  running_balance INTEGER NOT NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bardana_type_date ON bardana_ledger(packaging_type_id, date);
CREATE INDEX IF NOT EXISTS idx_bardana_voucher ON bardana_ledger(voucher_no);

-- ---------------------------------------------------------------- Attendance & payroll
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  date DATE NOT NULL,
  status attendance_status_enum NOT NULL,
  overtime_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  notes TEXT,
  correction_reason TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  pay_type pay_type_enum NOT NULL,
  -- Historical snapshot: the rate actually applied, kept even if the
  -- employee master rate changes later (spec §13.1).
  applied_rate NUMERIC(12,2) NOT NULL,
  payable_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  present_days INTEGER NOT NULL DEFAULT 0,
  half_days INTEGER NOT NULL DEFAULT 0,
  leave_days INTEGER NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  holiday_days INTEGER NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  base_pay NUMERIC(15,2) NOT NULL DEFAULT 0,
  overtime_pay NUMERIC(15,2) NOT NULL DEFAULT 0,
  bonus NUMERIC(15,2) NOT NULL DEFAULT 0,
  advance_recovery NUMERIC(15,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
  previous_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  adjustment_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  gross_pay NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status payroll_status_enum NOT NULL DEFAULT 'draft',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  reversal_reason TEXT,
  client_token TEXT UNIQUE,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- A re-run after a reversal is allowed; two live runs are not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_live_period
  ON payroll_periods(employee_id, month, year) WHERE status <> 'reversed';
CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_periods(year, month);
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll_periods(employee_id);

CREATE TABLE IF NOT EXISTS payroll_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  cash_account_id UUID REFERENCES cash_accounts(id) ON DELETE SET NULL,
  account TEXT CHECK (account IN ('cash', 'bank', 'online')),
  reference_no TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_advances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  recovered_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'recovered', 'reversed')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_advances_employee ON employee_advances(employee_id);

-- ---------------------------------------------------------------- Opening balances (evidence record)
-- See header comment: this table EVIDENCES an opening; the live opening
-- lives in the master (parties / cash_accounts). Never add both.
CREATE TABLE IF NOT EXISTS opening_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  balance_kind TEXT NOT NULL CHECK (balance_kind IN ('cash', 'party', 'stock', 'bardana', 'payroll')),
  entity_key TEXT UNIQUE NOT NULL,
  party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  cash_account_id UUID REFERENCES cash_accounts(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  packaging_type_id UUID REFERENCES packaging_types(id) ON DELETE SET NULL,
  godown_id UUID REFERENCES godowns(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  as_of DATE NOT NULL DEFAULT CURRENT_DATE,
  source_note TEXT,
  approved_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------- Audit log (append-only by convention)
-- No UPDATE/DELETE policy is granted below, and server code only ever
-- INSERTs. Supabase dashboard owners should additionally revoke UPDATE/
-- DELETE on this table for the authenticated role after first deploy.
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID,
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  voucher_no TEXT,
  before_summary JSONB,
  after_summary JSONB,
  reason TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);

-- ---------------------------------------------------------------- RLS (new tables only)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE bardana_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read/write through the server actions, which
-- enforce roles. Audit log is insert/select only for authenticated users
-- (append-only: deliberately no update/delete policy).
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'cash_accounts', 'app_settings', 'expense_categories',
    'purchases', 'purchase_items', 'purchase_returns', 'purchase_return_items',
    'customer_invoices', 'invoice_lines', 'customer_receipts',
    'invoice_allocations', 'vendor_payments', 'payment_allocations',
    'cash_transfers', 'party_ledger', 'bardana_ledger', 'attendance',
    'payroll_periods', 'payroll_payments', 'employee_advances',
    'opening_balances'] LOOP
    EXECUTE format(
      'CREATE POLICY "authenticated full via server actions" ON %I FOR ALL USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')',
      t);
  END LOOP;
END $$;
CREATE POLICY "authenticated insert audit" ON audit_log FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "authenticated read audit" ON audit_log FOR SELECT
  USING (auth.role() = 'authenticated');
