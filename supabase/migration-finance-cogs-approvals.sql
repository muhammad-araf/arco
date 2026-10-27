-- ============================================================================
-- COGS approvals table (spec §15.2) — finance team.
--
-- Apply AFTER supabase/schema.sql and supabase/schema-finance.sql (and
-- after supabase/migration-rls-base-tables.sql, which creates
-- public.current_app_role() used by the policies below).
-- Idempotent (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS);
-- re-runnable.
--
-- COGS stays accountant-supplied, never computed: the accountant
-- records one approved figure per calendar period here via
-- saveCogsApproval({ month, year, amount, basis, note }) in
-- app/actions/finance.ts, and the reports team reads it back with
-- getCogsApproval({ month, year }) and passes it to getPL as
-- cogsAmount. One row per (period_year, period_month): a re-save for
-- the same period updates the row (see the action), it never
-- duplicates it.
--
-- RLS mirrors the finance tables in migration-rls-finance-replace.sql:
-- SELECT for any signed-in operator, INSERT/UPDATE for Owner/Admin
-- and Accountant only, no DELETE policy (approvals are corrected by
-- re-saving, never deleted by the app).
--
-- NOT VERIFIED HERE: no live database in this workspace. Before
-- go-live, apply to the live project and confirm the table and
-- policies exist.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pl_cogs_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  basis TEXT,
  approved_by UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_pl_cogs_approvals_period
  ON pl_cogs_approvals (period_year, period_month);

ALTER TABLE pl_cogs_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select authenticated" ON public.pl_cogs_approvals;
CREATE POLICY "select authenticated" ON public.pl_cogs_approvals FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "insert finance writers" ON public.pl_cogs_approvals;
CREATE POLICY "insert finance writers" ON public.pl_cogs_approvals FOR INSERT
  WITH CHECK (public.current_app_role() IN ('owner_admin', 'accountant'));

DROP POLICY IF EXISTS "update finance writers" ON public.pl_cogs_approvals;
CREATE POLICY "update finance writers" ON public.pl_cogs_approvals FOR UPDATE
  USING (public.current_app_role() IN ('owner_admin', 'accountant'))
  WITH CHECK (public.current_app_role() IN ('owner_admin', 'accountant'));

GRANT SELECT, INSERT, UPDATE ON public.pl_cogs_approvals TO authenticated;
