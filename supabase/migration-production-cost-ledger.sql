-- ============================================================================
-- Production cost ledger (wave 2, gated — see the cost_ledger_enabled
-- app_settings key, default false). When the gate is OFF, the app writes
-- no rows here at all, so this table stays empty until an operator
-- turns the gate on in Settings.
--
-- One row per cost element of a posted batch or job: packaging cost
-- (bags × rate), ingredient quantities (with a monetary amount only
-- when a valuation method is configured — otherwise NULL with basis
-- 'unconfirmed-method', never a guessed method), and the job
-- processing charge. Exactly one of batch_id / job_id is set (CHECK).
--
-- Apply AFTER supabase/schema.sql and
-- supabase/migration-production-job-lines.sql (the FK targets).
-- Idempotent: CREATE IF NOT EXISTS + DROP POLICY IF EXISTS guards,
-- so the file can be re-run safely. Policies cover this NEW table
-- only and mirror the production tables' pattern; no existing table
-- or policy is touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.production_cost_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES public.production_batches(id) ON DELETE SET NULL,
  job_id UUID REFERENCES public.machinery_jobs(id) ON DELETE SET NULL,
  cost_type TEXT NOT NULL,
  amount NUMERIC,
  qty_kg NUMERIC,
  basis TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (batch_id IS NOT NULL AND job_id IS NULL)
    OR (batch_id IS NULL AND job_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_production_cost_ledger_batch
  ON public.production_cost_ledger(batch_id);
CREATE INDEX IF NOT EXISTS idx_production_cost_ledger_job
  ON public.production_cost_ledger(job_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.production_cost_ledger TO authenticated;

DO $$
BEGIN
  ALTER TABLE public.production_cost_ledger ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_app_role') THEN
    DROP POLICY IF EXISTS "select authenticated" ON public.production_cost_ledger;
    CREATE POLICY "select authenticated" ON public.production_cost_ledger
      FOR SELECT TO authenticated USING (true);
    DROP POLICY IF EXISTS "write production" ON public.production_cost_ledger;
    CREATE POLICY "write production" ON public.production_cost_ledger
      FOR ALL TO authenticated
      USING (public.current_app_role() IN ('owner_admin', 'production_operator'))
      WITH CHECK (public.current_app_role() IN ('owner_admin', 'production_operator'));
  END IF;
END $$;
