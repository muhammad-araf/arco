-- ============================================================================
-- Header actor columns (wave 2): who created / last changed each header
-- row. The actor value is the session actor's user id (the same value
-- the actions already pass as created_by on finance / payroll rows).
--
-- Table-name note: the program's "invoices" / "receipts" are the
-- schema's customer_invoices / customer_receipts tables.
--
-- Columns that already exist are left alone: purchases,
-- vendor_payments, payroll_periods and expenses already carry a
-- created_by UUID column (schema-finance.sql), so ADD COLUMN IF NOT
-- EXISTS skips it there and only updated_by is added. New columns are
-- TEXT and nullable, so pre-existing rows are unaffected.
--
-- Apply AFTER supabase/schema.sql and supabase/schema-finance.sql,
-- and BEFORE deploying app code that sets these columns. Idempotent:
-- every ALTER uses IF NOT EXISTS, so the file can be re-run safely.
-- No RLS policy is touched by this migration.
-- ============================================================================

ALTER TABLE public.incoming_goods ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.incoming_goods ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.gate_passes ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.gate_passes ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.production_batches ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.production_batches ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.machinery_jobs ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.machinery_jobs ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.packing_records ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.packing_records ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.customer_invoices ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.customer_invoices ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.customer_receipts ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.customer_receipts ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.vendor_payments ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.vendor_payments ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS updated_by TEXT;
