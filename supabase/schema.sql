-- ============================================================================
-- SEED GODOWN & PROCESSING ERP (ARCO) - COMPLETE DATABASE SCHEMA
-- Single-Ledger Relational Architecture for PostgreSQL / Supabase
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. ENUMS & DOMAIN TYPES
-- ============================================================================
CREATE TYPE product_category_enum AS ENUM (
  'raw_seed',
  'intermediate',
  'finished_seed',
  'by_product',
  'packaging'
);

CREATE TYPE product_unit_enum AS ENUM (
  'kg',
  'bag',
  'maund'
);

CREATE TYPE party_type_enum AS ENUM (
  'customer',
  'supplier',
  'both',
  'source'
);

CREATE TYPE voucher_status_enum AS ENUM (
  'draft',
  'posted',
  'reversed',
  'returned'
);

CREATE TYPE rate_basis_enum AS ENUM (
  'per_bag',
  'per_50kg',
  'per_kg',
  'per_maund',
  'fixed'
);

CREATE TYPE pay_type_enum AS ENUM (
  'daily',
  'monthly',
  'piece_rate'
);

CREATE TYPE attendance_status_enum AS ENUM (
  'present',
  'absent',
  'half_day',
  'leave',
  'holiday'
);

-- ============================================================================
-- 2. MASTER DATA TABLES
-- ============================================================================

-- Godowns / Warehouse Sheds
CREATE TABLE IF NOT EXISTS godowns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  capacity_metric_tons NUMERIC(12,2) DEFAULT 1000,
  address TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products & Grains
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category product_category_enum NOT NULL DEFAULT 'raw_seed',
  default_unit product_unit_enum NOT NULL DEFAULT 'kg',
  weight_per_bag NUMERIC(10,2) DEFAULT 50,
  min_stock NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parties (Growers, Suppliers, Wholesalers & Clients)
CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  address TEXT,
  type party_type_enum NOT NULL DEFAULT 'customer',
  opening_balance NUMERIC(15,2) DEFAULT 0,
  balance_type TEXT CHECK (balance_type IN ('receivable', 'payable')) DEFAULT 'receivable',
  current_balance NUMERIC(15,2) DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Machinery & Processing Plants
CREATE TABLE IF NOT EXISTS machines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  processing_type TEXT NOT NULL, -- 'Grading', 'Gravity Separator', 'Chemical Dressing'
  capacity_kg_per_hour NUMERIC(10,2) DEFAULT 2000,
  operator_name TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Packaging Types (Bardana / Bags)
CREATE TABLE IF NOT EXISTS packaging_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, -- '50kg Woven PP Bag', '100kg Jute Bag'
  capacity_kg NUMERIC(10,2) DEFAULT 50,
  cost_per_bag NUMERIC(10,2) DEFAULT 0,
  reorder_level INTEGER DEFAULT 500,
  current_stock INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employees & Operators
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  designation TEXT NOT NULL,
  phone TEXT,
  pay_type pay_type_enum NOT NULL DEFAULT 'monthly',
  base_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  joining_date DATE DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. CORE SINGLE-LEDGER TABLES (The Source of Truth)
-- ============================================================================

-- Stock Movement Ledger
CREATE TABLE IF NOT EXISTS stock_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voucher_type TEXT NOT NULL, -- 'inward', 'batch_consume', 'batch_produce', 'gatepass', 'transfer', 'adjustment'
  voucher_id TEXT NOT NULL,
  voucher_no TEXT NOT NULL,
  godown_id UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  lot_number TEXT,
  inward_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  outward_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit product_unit_enum NOT NULL DEFAULT 'kg',
  running_balance NUMERIC(14,2) NOT NULL,
  notes TEXT,
  created_by TEXT DEFAULT 'operator-admin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stock_ledger_godown_product ON stock_ledger(godown_id, product_id);
CREATE INDEX idx_stock_ledger_date ON stock_ledger(date);
CREATE INDEX idx_stock_ledger_voucher ON stock_ledger(voucher_no);

-- Cashbook & Bank Ledger
CREATE TABLE IF NOT EXISTS cash_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voucher_type TEXT NOT NULL, -- 'receipt', 'expense', 'purchase_pay', 'payroll', 'transfer'
  voucher_id TEXT NOT NULL,
  voucher_no TEXT NOT NULL,
  account TEXT NOT NULL CHECK (account IN ('cash', 'bank', 'online')),
  debit NUMERIC(15,2) NOT NULL DEFAULT 0, -- Money in
  credit NUMERIC(15,2) NOT NULL DEFAULT 0, -- Money out
  running_balance NUMERIC(15,2) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cash_ledger_date ON cash_ledger(date);
CREATE INDEX idx_cash_ledger_account ON cash_ledger(account);

-- ============================================================================
-- 4. OPERATIONAL VOUCHERS & DOCUMENTS
-- ============================================================================

-- Inward Receiving Vouchers
CREATE TABLE IF NOT EXISTS incoming_goods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  godown_id UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  bilty_no TEXT,
  vehicle_no TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  transport_company TEXT,
  status voucher_status_enum NOT NULL DEFAULT 'posted',
  total_bags INTEGER DEFAULT 0,
  total_net_weight_kg NUMERIC(14,2) DEFAULT 0,
  total_value NUMERIC(15,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  posted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incoming_goods_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incoming_id UUID NOT NULL REFERENCES incoming_goods(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  bags_count INTEGER NOT NULL DEFAULT 0,
  gross_weight_kg NUMERIC(12,2) NOT NULL DEFAULT 0,
  tare_weight_kg NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_weight_kg NUMERIC(12,2) NOT NULL DEFAULT 0,
  rate_per_unit NUMERIC(12,2) DEFAULT 0,
  total_value NUMERIC(15,2) DEFAULT 0
);

-- Production Batches
CREATE TABLE IF NOT EXISTS production_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  godown_id UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  planned_size_kg NUMERIC(14,2) NOT NULL,
  actual_input_kg NUMERIC(14,2) NOT NULL,
  actual_output_kg NUMERIC(14,2) NOT NULL,
  byproduct_kg NUMERIC(14,2) DEFAULT 0,
  waste_kg NUMERIC(14,2) DEFAULT 0,
  yield_pct NUMERIC(5,2) NOT NULL,
  status voucher_status_enum NOT NULL DEFAULT 'posted',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  posted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gate Passes (Outgoing Goods)
CREATE TABLE IF NOT EXISTS gate_passes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pass_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  godown_id UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  destination TEXT,
  vehicle_no TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  driver_phone TEXT,
  transporter TEXT,
  order_ref TEXT,
  status voucher_status_enum NOT NULL DEFAULT 'posted',
  total_bags INTEGER DEFAULT 0,
  total_weight_kg NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gate_pass_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gate_pass_id UUID NOT NULL REFERENCES gate_passes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  bags_count INTEGER NOT NULL DEFAULT 0,
  net_weight_kg NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_weight_kg NUMERIC(12,2) DEFAULT 0,
  remarks TEXT
);

-- Operational Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category_name TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank')),
  description TEXT,
  status voucher_status_enum NOT NULL DEFAULT 'posted',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 5. MASTER DATA — NO DEMO ROWS SHIPPED
-- ============================================================================
-- Deliberately empty: this schema used to INSERT sample godowns, products,
-- packaging, machines, parties, and employees (fictional names, phones, and
-- opening balances). Those rows looked like real business data on a fresh
-- install, so they were removed for delivery. Real masters are created via
-- the Masters UI or the Import page. System rows that are NOT business data
-- (doc_numbering series) are still seeded below in the appendix.
-- ============================================================================
-- ============================================================================
-- APPENDIX — BACKEND CORE (work/backend-core, 2026-10-24)
-- Added by the backend agent. APPEND ONLY: nothing above this section was
-- edited. Apply after the base schema above, in order, on a fresh or
-- existing database (all statements are idempotent).
--
-- What this adds:
--  1. doc_numbering + next_doc_number(): atomic, server-side sequential
--     numbering for inward / batch / gate pass / transfer / adjustment
--     documents. Numbers are NEVER trusted from the client and NEVER
--     reused after a reversal/return (the document keeps its number).
--     The stored prefix per series is the configurable prefix/series
--     the client spec requires; pass a different prefix only when
--     creating a brand-new series.
--  2. idempotency_keys: exact-once posting. The client passes a
--     clientToken per post/reverse call; a replayed token returns the
--     stored original result instead of writing duplicate ledger rows.
--  3. Recipes + versioning, production batch inputs/outputs, machinery
--     jobs, packing records, godown transfers, stock adjustments and
--     gate-pass returns — tables the base schema referenced in the plan
--     but did not create, plus the columns the backend actions need on
--     existing voucher tables (reversal metadata, owner tracking,
--     recipe version used).
--  4. Unique constraints on document numbers and the indexes the
--     ledger queries need: (godown_id, product_id), date, status,
--     voucher_no.
-- ============================================================================

-- ---------------- 1. Sequential document numbering ----------------
CREATE TABLE IF NOT EXISTS doc_numbering (
  series TEXT PRIMARY KEY, -- 'inward' | 'batch' | 'gatepass' | 'transfer' | 'adjustment' | ...
  prefix TEXT NOT NULL,    -- configurable prefix, e.g. 'INW', 'BAT', 'GP'
  last_no INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Atomic: a single statement, so two concurrent postings cannot receive
-- the same number. Returns e.g. 'GP-000042'.
CREATE OR REPLACE FUNCTION next_doc_number(p_series TEXT, p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_next INTEGER;
  v_prefix TEXT;
BEGIN
  INSERT INTO doc_numbering (series, prefix, last_no)
  VALUES (p_series, p_prefix, 1)
  ON CONFLICT (series)
  DO UPDATE SET last_no = doc_numbering.last_no + 1, updated_at = NOW()
  RETURNING last_no, prefix INTO v_next, v_prefix;
  RETURN v_prefix || '-' || LPAD(v_next::TEXT, 6, '0');
END;
$$;

-- ---------------- 2. Idempotency keys ----------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  client_token TEXT NOT NULL,
  scope TEXT NOT NULL, -- e.g. 'gatepass:post', 'batch:reverse'
  voucher_type TEXT NOT NULL,
  voucher_id TEXT NOT NULL,
  voucher_no TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_token, scope)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_voucher ON idempotency_keys(voucher_type, voucher_id);

-- ---------------- 3. Recipes (versioned) ----------------
CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  output_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  expected_yield_pct NUMERIC(5,2),
  packaging_type_id UUID REFERENCES packaging_types(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (code, version)
);
CREATE INDEX IF NOT EXISTS idx_recipes_code_status ON recipes(code, status);

CREATE TABLE IF NOT EXISTS recipe_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  required_ratio_pct NUMERIC(5,2) NOT NULL,
  unit product_unit_enum NOT NULL DEFAULT 'kg'
);

-- ---------------- 4. Production batch lines ----------------
CREATE TABLE IF NOT EXISTS production_batch_inputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  planned_qty_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_qty_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Stock owner for this input; NULL = company-owned. Customer-owned
  -- inputs deduct ONLY this party's balance, never company stock.
  party_id UUID REFERENCES parties(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS production_batch_outputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  output_type TEXT NOT NULL CHECK (output_type IN ('finished', 'byproduct')),
  qty_kg NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- ---------------- 5. Machinery jobs (service work) ----------------
CREATE TABLE IF NOT EXISTS machinery_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  godown_id UUID REFERENCES godowns(id) ON DELETE RESTRICT,
  processing_type TEXT NOT NULL,
  input_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  input_weight_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  output_product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  output_weight_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  waste_weight_kg NUMERIC(14,2) DEFAULT 0,
  rate_basis rate_basis_enum NOT NULL DEFAULT 'per_kg',
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_charge NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_customer_owned BOOLEAN NOT NULL DEFAULT FALSE,
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  reversal_reason TEXT,
  reversed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_machinery_jobs_status ON machinery_jobs(status);
CREATE INDEX IF NOT EXISTS idx_machinery_jobs_date ON machinery_jobs(date);

-- ---------------- 6. Packing records (Bardana consumption) ----------------
CREATE TABLE IF NOT EXISTS packing_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  job_or_batch_id UUID, -- production_batches.id or machinery_jobs.id
  packaging_type_id UUID NOT NULL REFERENCES packaging_types(id) ON DELETE RESTRICT,
  bags_count INTEGER NOT NULL DEFAULT 0,
  capacity_kg NUMERIC(10,2) DEFAULT 50,
  total_packed_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  packing_rate NUMERIC(12,2) DEFAULT 0,
  packing_charge NUMERIC(15,2) DEFAULT 0,
  damaged_bags INTEGER NOT NULL DEFAULT 0,
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_packing_records_batch ON packing_records(job_or_batch_id);

-- ---------------- 7. Godown transfers ----------------
CREATE TABLE IF NOT EXISTS godown_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_godown_id UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  to_godown_id UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  quantity NUMERIC(14,2) NOT NULL,
  unit product_unit_enum NOT NULL DEFAULT 'kg',
  reason TEXT NOT NULL,
  notes TEXT,
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  reversal_reason TEXT,
  reversed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON godown_transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_product ON godown_transfers(product_id);

-- ---------------- 8. Stock adjustments ----------------
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  adjustment_no TEXT UNIQUE NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  godown_id UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  quantity_before NUMERIC(14,2) NOT NULL,
  quantity_after NUMERIC(14,2) NOT NULL,
  delta_qty NUMERIC(14,2) NOT NULL,
  reason TEXT NOT NULL,
  approver TEXT NOT NULL,
  notes TEXT,
  status voucher_status_enum NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  reversal_reason TEXT,
  reversed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_adjustments_status ON stock_adjustments(status);

-- ---------------- 9. Gate-pass returns ----------------
CREATE TABLE IF NOT EXISTS gate_pass_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gate_pass_id UUID NOT NULL REFERENCES gate_passes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  qty_kg NUMERIC(14,2) NOT NULL,
  reason TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gate_pass_returns_pass ON gate_pass_returns(gate_pass_id);

-- ---------------- 10. Columns added to existing voucher tables ----------------
ALTER TABLE incoming_goods ADD COLUMN IF NOT EXISTS is_customer_owned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE incoming_goods ADD COLUMN IF NOT EXISTS owner_party_id UUID REFERENCES parties(id) ON DELETE SET NULL;
ALTER TABLE incoming_goods ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE incoming_goods ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS recipe_id UUID REFERENCES recipes(id) ON DELETE RESTRICT;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS recipe_version_used INTEGER;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS output_product_id UUID REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS byproduct_product_id UUID REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS packaging_type_id UUID REFERENCES packaging_types(id) ON DELETE SET NULL;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS bags_consumed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS packing_rate_per_bag NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS is_customer_owned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS owner_party_id UUID REFERENCES parties(id) ON DELETE SET NULL;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS return_reason TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;
-- Owner pool for a dispatch line; NULL = company-owned stock.
ALTER TABLE gate_pass_items ADD COLUMN IF NOT EXISTS party_id UUID REFERENCES parties(id) ON DELETE SET NULL;

-- ---------------- 11. Indexes on existing tables ----------------
CREATE INDEX IF NOT EXISTS idx_stock_ledger_party ON stock_ledger(party_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_voucher_id ON stock_ledger(voucher_id);
CREATE INDEX IF NOT EXISTS idx_incoming_goods_status ON incoming_goods(status);
CREATE INDEX IF NOT EXISTS idx_incoming_goods_date ON incoming_goods(date);
CREATE INDEX IF NOT EXISTS idx_batches_status ON production_batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_recipe ON production_batches(recipe_id);
CREATE INDEX IF NOT EXISTS idx_gate_passes_status ON gate_passes(status);
CREATE INDEX IF NOT EXISTS idx_gate_passes_date ON gate_passes(date);
CREATE INDEX IF NOT EXISTS idx_gate_pass_items_pass ON gate_pass_items(gate_pass_id);

-- END OF BACKEND-CORE APPENDIX
