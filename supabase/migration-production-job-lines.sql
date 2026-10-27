-- ============================================================================
-- Production-gap migration (spec §6, §7, §8): multi-line machinery jobs,
-- packing completion, treatment inputs (record-only), batch/recipe fields.
--
-- Apply AFTER supabase/schema.sql, supabase/schema-finance.sql and
-- supabase/migration-rls-base-tables.sql (the RLS policies below call
-- public.current_app_role(), which that migration defines). The settings
-- team's tables are NOT created here: `variance_tolerance_pct` (an
-- app_settings key) and `processing_types` are owned by the settings
-- team; the production actions read them tolerantly and treat a missing
-- setting/table as "not configured".
--
-- Cost-ledger writes into batch/job posting are wave-2 work and are
-- deliberately NOT in this migration.
--
-- Idempotent: every ALTER uses IF NOT EXISTS (via a DO block where
-- Postgres requires it) and every CREATE uses IF NOT EXISTS, so the
-- file can be re-run safely.
-- ============================================================================

-- ---------------- 1. Machinery jobs: operator + header by-product ----
-- operator_name: the operator who ran the job (free text; the operator
-- is not an employee row, so no FK — the client has not defined an
-- operator master). byproduct_* mirrors the batch header: a single-line
-- job's by-product, stocked on post exactly like a job-line by-product.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'machinery_jobs'
                 AND column_name = 'operator_name') THEN
    ALTER TABLE public.machinery_jobs ADD COLUMN operator_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'machinery_jobs'
                 AND column_name = 'byproduct_product_id') THEN
    ALTER TABLE public.machinery_jobs
      ADD COLUMN byproduct_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'machinery_jobs'
                 AND column_name = 'byproduct_weight_kg') THEN
    ALTER TABLE public.machinery_jobs ADD COLUMN byproduct_weight_kg NUMERIC(14,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ---------------- 2. Multi-line machinery jobs -----------------------
-- One row per job line. The header keeps the job-level totals (input /
-- output / by-product / waste / charge) so existing list views keep
-- working; a job WITH lines posts from its lines, a job WITHOUT lines
-- posts from its header exactly as before. Charge basis stays job-level
-- (see app/actions/production-helpers.ts): the charge is computed once
-- over the job's total input weight, never per line.
-- By-product lines ARE stocked; waste stays header-only and unstocked.
CREATE TABLE IF NOT EXISTS public.machinery_job_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES public.machinery_jobs(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 0,
  input_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  input_qty_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  output_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  output_qty_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  byproduct_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  byproduct_qty_kg NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_machinery_job_lines_job
  ON public.machinery_job_lines(job_id, line_no);

-- ---------------- 3. Production batches: customer/order/operator -----
-- + variance_reason (nullable): required at posting time ONLY when the
-- configured variance_tolerance_pct setting exists and an input
-- variance exceeds it; null tolerance = gate disabled.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'production_batches'
                 AND column_name = 'customer_id') THEN
    ALTER TABLE public.production_batches
      ADD COLUMN customer_id UUID REFERENCES public.parties(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'production_batches'
                 AND column_name = 'order_ref') THEN
    ALTER TABLE public.production_batches ADD COLUMN order_ref TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'production_batches'
                 AND column_name = 'operator_name') THEN
    ALTER TABLE public.production_batches ADD COLUMN operator_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'production_batches'
                 AND column_name = 'variance_reason') THEN
    ALTER TABLE public.production_batches ADD COLUMN variance_reason TEXT;
  END IF;
END $$;

-- ---------------- 4. Recipes: effective_from (nullable) --------------
-- No approval workflow: status stays active/retired as today. The
-- date is informational (from when this version applies).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'recipes'
                 AND column_name = 'effective_from') THEN
    ALTER TABLE public.recipes ADD COLUMN effective_from DATE;
  END IF;
END $$;

-- ---------------- 5. Packing records: completion columns -------------
-- party_id: the customer/owner party the packing was done for (NULL =
-- company). processing_type: free text until the settings team's
-- processing_types master lands; the form offers its rows as a
-- dropdown and falls back to free text when the table is empty.
-- source_product_id: the product that went INTO packing. net_weight_kg:
-- weighed net packed weight (header total_packed_kg stays the sum of
-- the lines). processing_amount: the processing fee for this packing
-- run, separate from the bardana labour charge (packing_charge).
-- manual_packing_fee: set ONLY when the operator enters a manual fee
-- override; packing_charge then equals it instead of bags x rate.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'packing_records'
                 AND column_name = 'party_id') THEN
    ALTER TABLE public.packing_records
      ADD COLUMN party_id UUID REFERENCES public.parties(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'packing_records'
                 AND column_name = 'processing_type') THEN
    ALTER TABLE public.packing_records ADD COLUMN processing_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'packing_records'
                 AND column_name = 'source_product_id') THEN
    ALTER TABLE public.packing_records
      ADD COLUMN source_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'packing_records'
                 AND column_name = 'net_weight_kg') THEN
    ALTER TABLE public.packing_records ADD COLUMN net_weight_kg NUMERIC(14,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'packing_records'
                 AND column_name = 'processing_amount') THEN
    ALTER TABLE public.packing_records ADD COLUMN processing_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'packing_records'
                 AND column_name = 'notes') THEN
    ALTER TABLE public.packing_records ADD COLUMN notes TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'packing_records'
                 AND column_name = 'manual_packing_fee') THEN
    ALTER TABLE public.packing_records ADD COLUMN manual_packing_fee NUMERIC(15,2);
  END IF;
END $$;

-- ---------------- 6. Packing lines (multi-line packing) --------------
-- Batch packing keeps writing exactly ONE line (compatibility); the
-- standalone packing form may write many. Line charge = bags x the
-- header rate, unless the header carries a manual fee override.
CREATE TABLE IF NOT EXISTS public.packing_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  packing_record_id UUID NOT NULL REFERENCES public.packing_records(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 0,
  packaging_type_id UUID NOT NULL REFERENCES public.packaging_types(id) ON DELETE RESTRICT,
  bags INTEGER NOT NULL DEFAULT 0,
  packed_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  charge NUMERIC(15,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_packing_lines_record
  ON public.packing_lines(packing_record_id, line_no);

-- ---------------- 7. Treatment inputs: RECORD-ONLY -------------------
-- No ledger, no stock movement, ever: spec gates inventory impact on
-- client confirmation, so these rows are a record of what treatment
-- material was used, and nothing else. The server action that writes
-- them performs no stock write for them.
CREATE TABLE IF NOT EXISTS public.packing_treatment_inputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  packing_record_id UUID NOT NULL REFERENCES public.packing_records(id) ON DELETE CASCADE,
  material_name TEXT NOT NULL,
  qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_packing_treatment_inputs_record
  ON public.packing_treatment_inputs(packing_record_id);

-- ---------------- 8. Grants + RLS for the NEW tables only ------------
-- Existing tables and their policies are untouched. New tables follow
-- the base-tables pattern (migration-rls-base-tables.sql): any
-- authenticated user may read; writes are limited to the production /
-- machinery writer roles via public.current_app_role(). The policy
-- block is skipped if that function does not exist yet (migration
-- applied out of order) — re-running this file after the base RLS
-- migration then installs the policies.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.machinery_job_lines, public.packing_lines, public.packing_treatment_inputs
  TO authenticated;

DO $$
BEGIN
  ALTER TABLE public.machinery_job_lines ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.packing_lines ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.packing_treatment_inputs ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_app_role') THEN
    DROP POLICY IF EXISTS "select authenticated" ON public.machinery_job_lines;
    CREATE POLICY "select authenticated" ON public.machinery_job_lines
      FOR SELECT TO authenticated USING (true);
    DROP POLICY IF EXISTS "write production" ON public.machinery_job_lines;
    CREATE POLICY "write production" ON public.machinery_job_lines
      FOR ALL TO authenticated
      USING (public.current_app_role() IN ('owner_admin', 'production_operator'))
      WITH CHECK (public.current_app_role() IN ('owner_admin', 'production_operator'));

    DROP POLICY IF EXISTS "select authenticated" ON public.packing_lines;
    CREATE POLICY "select authenticated" ON public.packing_lines
      FOR SELECT TO authenticated USING (true);
    DROP POLICY IF EXISTS "write production" ON public.packing_lines;
    CREATE POLICY "write production" ON public.packing_lines
      FOR ALL TO authenticated
      USING (public.current_app_role() IN ('owner_admin', 'production_operator'))
      WITH CHECK (public.current_app_role() IN ('owner_admin', 'production_operator'));

    DROP POLICY IF EXISTS "select authenticated" ON public.packing_treatment_inputs;
    CREATE POLICY "select authenticated" ON public.packing_treatment_inputs
      FOR SELECT TO authenticated USING (true);
    DROP POLICY IF EXISTS "write production" ON public.packing_treatment_inputs;
    CREATE POLICY "write production" ON public.packing_treatment_inputs
      FOR ALL TO authenticated
      USING (public.current_app_role() IN ('owner_admin', 'production_operator'))
      WITH CHECK (public.current_app_role() IN ('owner_admin', 'production_operator'));
  END IF;
END $$;
