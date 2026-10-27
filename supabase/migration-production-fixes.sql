-- ===========================================================================
-- Production chain fixes (QA audit 2026-10-27: blocker B8 + production majors)
-- Apply AFTER supabase/schema.sql, schema-finance.sql, and the RLS
-- migrations, in the Supabase SQL editor. All statements are idempotent
-- (IF NOT EXISTS / drop-if-exists) EXCEPT the single-active-recipe index:
-- it fails if the live database already holds two active versions of one
-- recipe code — retire the duplicates first, then re-run this file.
--
-- What this adds:
--  1. machinery_jobs.bags + maund_kg — the actual bag count and the
--     client-approved kg per maund the charge was computed from, so a
--     posted job's charge is recomputable and auditable (never derived
--     from weight assuming 50 kg, never a hardcoded maund value).
--  2. production_batches.variances (JSONB) + damaged_bags — computed
--     per-input variances are stored at post time instead of being
--     computed and dropped, and batch packing damage is recorded.
--  3. packing_records.packing_no + output_product_id — packing history
--     can be listed from packing_records itself with a real number and
--     the packed product, instead of being rebuilt from batches.
--  4. One active recipe version per code: a partial unique index plus
--     the server-side duplicate check in createRecipe /
--     createRecipeVersion. The index is the concurrency backstop; the
--     server turns its violation into a plain-language error.
--  5. RLS for the new write paths: machinery_jobs draft DELETE (the
--     orphan-draft delete action) and bardana_ledger inserts by the
--     production operator for batch/packing vouchers only. Finance
--     bardana writes keep their existing owner/accountant policy.
-- ===========================================================================

-- --- 1. Machinery job charge inputs ---------------------------------------
alter table public.machinery_jobs
  add column if not exists bags integer;
alter table public.machinery_jobs
  add column if not exists maund_kg numeric(10, 2);

-- --- 2. Batch variances + packing damage ----------------------------------
alter table public.production_batches
  add column if not exists variances jsonb;
alter table public.production_batches
  add column if not exists damaged_bags integer not null default 0;

-- --- 3. Packing record identity + packed product ---------------------------
alter table public.packing_records
  add column if not exists packing_no text;
alter table public.packing_records
  add column if not exists output_product_id uuid references public.products(id) on delete set null;

-- --- 4. Single active recipe version per code ------------------------------
create unique index if not exists idx_recipes_single_active
  on public.recipes (code)
  where status = 'active';

-- --- 5. RLS: delete draft machinery jobs -----------------------------------
drop policy if exists "delete draft only" on public.machinery_jobs;
create policy "delete draft only" on public.machinery_jobs
  for delete using (
    public.current_app_role() in ('owner_admin', 'production_operator')
    and status = 'draft');
grant delete on public.machinery_jobs to authenticated;

-- --- 6. RLS: production-operator bardana inserts for batch/packing ---------
-- The finance policy (owner_admin/accountant) stays in place; RLS policies
-- are permissive, so this second policy only opens the batch/packing
-- voucher types to the production operator — no other bardana write.
drop policy if exists "insert production packing" on public.bardana_ledger;
create policy "insert production packing" on public.bardana_ledger
  for insert with check (
    public.current_app_role() in ('owner_admin', 'production_operator')
    and voucher_type in ('batch_packing', 'batch_packing_reversal', 'packing', 'packing_reversal'));
