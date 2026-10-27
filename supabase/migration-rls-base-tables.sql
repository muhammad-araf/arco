-- ============================================================================
-- Security migration (QA blockers B1 + B3): Row Level Security on the
-- BASE tables from supabase/schema.sql, plus role-scoped policies.
--
-- Apply AFTER supabase/schema.sql AND supabase/schema-finance.sql, and
-- BEFORE supabase/migration-rls-finance-replace.sql (that file drops the
-- old finance "authenticated full" policies; this file must run first so
-- the profiles table it reads already exists).
--
-- Why this file exists: schema.sql enabled RLS on zero tables, so any
-- authenticated caller with the anon key could read/write stock and
-- master data directly through PostgREST, bypassing the server-action
-- role gates entirely. After this migration, the anon key alone buys
-- nothing: every row access is filtered by these policies.
--
-- How the policies work with the app's access pattern: server actions
-- run with the signed-in operator's session (anon key + user JWT), so
-- auth.uid() is the operator and auth.role() is 'authenticated'.
-- public.current_app_role() resolves that uid to the app's role via the
-- profiles table. It is SECURITY DEFINER so it is not itself blocked by
-- the profiles SELECT policy below (and in
-- migration-rls-finance-replace.sql); it normalises legacy "owner" /
-- "admin" spellings to owner_admin, exactly like getCurrentActor() in
-- app/actions/auth.ts, and returns NULL for a user with no profile or
-- an unrecognised role — which denies every write policy that calls it.
--
-- Policy shape, per table:
--   SELECT: any authenticated user. Stock/master reads in the actions
--     are open to any signed-in operator (requireSignedIn), so the RLS
--     read layer matches the action layer; finance/payroll sensitive
--     reads are restricted at the action layer instead.
--   INSERT / UPDATE: only the writer roles for that table (see the
--     matrix in the header of app/actions/auth.ts). No UPDATE policy
--     on stock_ledger / cash_ledger: both ledgers are append-only and
--     reversals write mirror rows, never edits.
--   DELETE: deliberately absent on almost every table (the app never
--     deletes history). The only exceptions are the draft-cleanup
--     deletes the stock actions already perform when a draft's line
--     insert fails: deleting a still-draft header (or, for recipes, a
--     header that has no lines yet). A posted/reversed row can never
--     be deleted through these policies.
--
-- This migration is idempotent (DROP POLICY IF EXISTS before each
-- CREATE POLICY) and can be re-run. It does NOT touch data.
--
-- NOT VERIFIED HERE: there is no live database in this workspace, so
-- these policies and the GRANTs below have never been executed against
-- a real project. Before go-live, apply them to the live project and
-- verify with the checks in SETUP.md §2 (sign in as each role and
-- confirm allowed writes succeed and denied writes fail, and confirm
-- the effective GRANTs with \z / pg_policies). See also the sign-up
-- toggle note in SETUP.md §3: with sign-ups on, a self-registered
-- user has no profile and is now denied everywhere — but the toggle
-- itself still has to be confirmed OFF in the live project.
-- ============================================================================

-- --- Role lookup ---------------------------------------------------------
-- SECURITY DEFINER: runs as the table owner, so profiles RLS cannot
-- block the lookup itself. search_path is pinned so a caller cannot
-- redirect the profiles reference.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.role::text in ('owner_admin', 'owner', 'admin') then 'owner_admin'
    when p.role::text in (
      'storekeeper', 'production_operator', 'gate_operator',
      'accountant', 'hr_payroll', 'read_only_manager'
    ) then p.role::text
    else null
  end
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke execute on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

-- --- Enable RLS on every base table --------------------------------------
alter table public.godowns enable row level security;
alter table public.products enable row level security;
alter table public.parties enable row level security;
alter table public.machines enable row level security;
alter table public.packaging_types enable row level security;
alter table public.employees enable row level security;
alter table public.stock_ledger enable row level security;
alter table public.cash_ledger enable row level security;
alter table public.incoming_goods enable row level security;
alter table public.incoming_goods_items enable row level security;
alter table public.production_batches enable row level security;
alter table public.production_batch_inputs enable row level security;
alter table public.production_batch_outputs enable row level security;
alter table public.gate_passes enable row level security;
alter table public.gate_pass_items enable row level security;
alter table public.expenses enable row level security;
alter table public.doc_numbering enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.machinery_jobs enable row level security;
alter table public.packing_records enable row level security;
alter table public.godown_transfers enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.gate_pass_returns enable row level security;

-- --- Shared read policy: any signed-in operator ---------------------------
-- Applied table by table (policy names live per table, so the same name
-- can be reused). No policy is created for DELETE unless listed below,
-- which means DELETE is denied on those tables even for writers.
do $$
declare
  t text;
begin
  foreach t in array array[
    'godowns', 'products', 'parties', 'machines', 'packaging_types',
    'employees', 'stock_ledger', 'cash_ledger', 'incoming_goods',
    'incoming_goods_items', 'production_batches', 'production_batch_inputs',
    'production_batch_outputs', 'gate_passes', 'gate_pass_items',
    'expenses', 'doc_numbering', 'idempotency_keys', 'recipes',
    'recipe_items', 'machinery_jobs', 'packing_records',
    'godown_transfers', 'stock_adjustments', 'gate_pass_returns'
  ] loop
    execute format('drop policy if exists "select authenticated" on public.%I', t);
    execute format(
      'create policy "select authenticated" on public.%I for select ' ||
      'using (auth.role() = ''authenticated'')', t);
  end loop;
end $$;

-- --- Masters: writes are Owner/Admin only ---------------------------------
-- Exception (documented): packaging_types UPDATE also allows
-- production_operator, because postBatch / reverseBatch decrement /
-- restore packaging_types.current_stock when a batch consumes or
-- returns bags. That action-level flow is gated to production writers;
-- the RLS exception exists only so it is not blocked at the table
-- layer. Creating a packaging type (INSERT) stays Owner/Admin only,
-- and no DELETE policy exists for any master table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'godowns', 'products', 'parties', 'machines', 'packaging_types',
    'employees'
  ] loop
    execute format('drop policy if exists "insert owner_admin" on public.%I', t);
    execute format(
      'create policy "insert owner_admin" on public.%I for insert ' ||
      'with check (public.current_app_role() = ''owner_admin'')', t);
  end loop;
  foreach t in array array[
    'godowns', 'products', 'parties', 'machines', 'employees'
  ] loop
    execute format('drop policy if exists "update owner_admin" on public.%I', t);
    execute format(
      'create policy "update owner_admin" on public.%I for update ' ||
      'using (public.current_app_role() = ''owner_admin'') ' ||
      'with check (public.current_app_role() = ''owner_admin'')', t);
  end loop;
end $$;

drop policy if exists "update owner_admin_or_production" on public.packaging_types;
create policy "update owner_admin_or_production" on public.packaging_types
  for update
  using (public.current_app_role() in ('owner_admin', 'production_operator'))
  with check (public.current_app_role() in ('owner_admin', 'production_operator'));

-- --- Ledgers: append-only --------------------------------------------------
-- stock_ledger is written by stock actions (storekeeper / production
-- operator) and by finance postPurchase for seed purchases
-- (accountant), so all four writer roles may INSERT. cash_ledger is
-- written by finance (owner_admin / accountant) and payroll settlement
-- (hr_payroll). Neither ledger has an UPDATE or DELETE policy.
drop policy if exists "insert ledger writers" on public.stock_ledger;
create policy "insert ledger writers" on public.stock_ledger
  for insert with check (public.current_app_role() in (
    'owner_admin', 'storekeeper', 'production_operator', 'accountant'));

drop policy if exists "insert ledger writers" on public.cash_ledger;
create policy "insert ledger writers" on public.cash_ledger
  for insert with check (public.current_app_role() in (
    'owner_admin', 'accountant', 'hr_payroll'));

-- --- Stock vouchers: storekeeper writes -------------------------------------
-- incoming_goods (+ items), gate_passes (+ items), gate_pass_returns,
-- godown_transfers, stock_adjustments. Draft-cleanup DELETE is allowed
-- only while the header is still a draft; line rows follow via
-- ON DELETE CASCADE (cascade deletes are not RLS-checked on the child).
do $$
declare
  t text;
begin
  foreach t in array array[
    'incoming_goods', 'incoming_goods_items', 'gate_passes',
    'gate_pass_items', 'gate_pass_returns', 'godown_transfers',
    'stock_adjustments'
  ] loop
    execute format('drop policy if exists "insert stock writers" on public.%I', t);
    execute format(
      'create policy "insert stock writers" on public.%I for insert ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''storekeeper''))', t);
    execute format('drop policy if exists "update stock writers" on public.%I', t);
    execute format(
      'create policy "update stock writers" on public.%I for update ' ||
      'using (public.current_app_role() in (''owner_admin'', ''storekeeper'')) ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''storekeeper''))', t);
  end loop;
end $$;

drop policy if exists "delete draft only" on public.incoming_goods;
create policy "delete draft only" on public.incoming_goods
  for delete using (
    public.current_app_role() in ('owner_admin', 'storekeeper')
    and status = 'draft');

drop policy if exists "delete draft only" on public.gate_passes;
create policy "delete draft only" on public.gate_passes
  for delete using (
    public.current_app_role() in ('owner_admin', 'storekeeper')
    and status = 'draft');

-- --- Production: production-operator writes ----------------------------------
-- recipes (+ items), production_batches (+ inputs / outputs),
-- machinery_jobs, packing_records. Recipe draft-cleanup DELETE is
-- allowed only while the recipe has no lines yet (the actions delete
-- the header when the items insert fails, before the recipe is usable).
do $$
declare
  t text;
begin
  foreach t in array array[
    'recipes', 'recipe_items', 'production_batches',
    'production_batch_inputs', 'production_batch_outputs',
    'machinery_jobs', 'packing_records'
  ] loop
    execute format('drop policy if exists "insert production writers" on public.%I', t);
    execute format(
      'create policy "insert production writers" on public.%I for insert ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''production_operator''))', t);
    execute format('drop policy if exists "update production writers" on public.%I', t);
    execute format(
      'create policy "update production writers" on public.%I for update ' ||
      'using (public.current_app_role() in (''owner_admin'', ''production_operator'')) ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''production_operator''))', t);
  end loop;
end $$;

drop policy if exists "delete lineless recipe only" on public.recipes;
create policy "delete lineless recipe only" on public.recipes
  for delete using (
    public.current_app_role() in ('owner_admin', 'production_operator')
    and not exists (
      select 1 from public.recipe_items where recipe_items.recipe_id = recipes.id));

drop policy if exists "delete draft only" on public.production_batches;
create policy "delete draft only" on public.production_batches
  for delete using (
    public.current_app_role() in ('owner_admin', 'production_operator')
    and status = 'draft');

-- --- Shared sequences: doc numbers + idempotency ----------------------------
-- Every writer role advances doc_numbering and stores idempotency keys;
-- read_only_manager, gate_operator and unauthenticated callers may not.
-- No DELETE policy: numbering rows and idempotency keys are never
-- removed by the app.
drop policy if exists "insert writers" on public.doc_numbering;
create policy "insert writers" on public.doc_numbering
  for insert with check (public.current_app_role() in (
    'owner_admin', 'storekeeper', 'production_operator', 'accountant', 'hr_payroll'));

drop policy if exists "update writers" on public.doc_numbering;
create policy "update writers" on public.doc_numbering
  for update
  using (public.current_app_role() in (
    'owner_admin', 'storekeeper', 'production_operator', 'accountant', 'hr_payroll'))
  with check (public.current_app_role() in (
    'owner_admin', 'storekeeper', 'production_operator', 'accountant', 'hr_payroll'));

drop policy if exists "insert writers" on public.idempotency_keys;
create policy "insert writers" on public.idempotency_keys
  for insert with check (public.current_app_role() in (
    'owner_admin', 'storekeeper', 'production_operator', 'accountant', 'hr_payroll'));

drop policy if exists "update writers" on public.idempotency_keys;
create policy "update writers" on public.idempotency_keys
  for update
  using (public.current_app_role() in (
    'owner_admin', 'storekeeper', 'production_operator', 'accountant', 'hr_payroll'))
  with check (public.current_app_role() in (
    'owner_admin', 'storekeeper', 'production_operator', 'accountant', 'hr_payroll'));

-- --- Finance-written base table: expenses ------------------------------------
-- Expenses live in schema.sql but are written by the finance actions
-- (Owner/Admin, Accountant). No DELETE policy: reversals flip status,
-- they never delete.
drop policy if exists "insert finance writers" on public.expenses;
create policy "insert finance writers" on public.expenses
  for insert with check (public.current_app_role() in ('owner_admin', 'accountant'));

drop policy if exists "update finance writers" on public.expenses;
create policy "update finance writers" on public.expenses
  for update
  using (public.current_app_role() in ('owner_admin', 'accountant'))
  with check (public.current_app_role() in ('owner_admin', 'accountant'));

-- --- GRANTs ------------------------------------------------------------------
-- RLS is the enforcement layer, but the authenticated role still needs
-- table privileges for the policies to be reachable at all. DELETE is
-- granted only on the four tables whose draft-cleanup deletes the app
-- actually performs; every other base table gets SELECT / INSERT /
-- UPDATE only, so even a policy mistake cannot turn into a delete.
-- VERIFY LIVE: after applying, check effective grants in the live
-- project (\z in psql, or the Supabase table editor) — this workspace
-- has no live database to check against.
grant select, insert, update on all tables in schema public to authenticated;
grant delete on public.incoming_goods to authenticated;
grant delete on public.gate_passes to authenticated;
grant delete on public.recipes to authenticated;
grant delete on public.production_batches to authenticated;
