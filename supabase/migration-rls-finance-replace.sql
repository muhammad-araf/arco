-- ============================================================================
-- Security migration (QA blocker B3): replace the finance "authenticated
-- full" RLS policies with role-scoped policies.
--
-- Apply AFTER supabase/schema.sql, supabase/schema-finance.sql, AND
-- supabase/migration-rls-base-tables.sql (which creates
-- public.current_app_role(), used below).
--
-- What was wrong: schema-finance.sql granted FOR ALL USING
-- (auth.role() = 'authenticated') over 21 tables INCLUDING profiles.
-- Any authenticated user could UPDATE profiles SET role='owner_admin'
-- through PostgREST with the anon key, after which every requireRole
-- gate in the app passed. Audit rows could likewise be forged and read
-- by anyone with an account.
--
-- What this file does:
--   1. Drops the old "authenticated full via server actions" policy from
--      every finance table, and the old audit_log policies.
--   2. Recreates SELECT as authenticated for business tables (the
--      actions keep sensitive finance/payroll reads role-gated at the
--      action layer, per the existing pattern; plain lists are open
--      to any signed-in operator).
--   3. Scopes INSERT / UPDATE to the writer roles for each table group
--      (finance, payroll, payroll-pay, settings, profiles, audit).
--   4. Locks profiles down: readable self-only (or by Owner/Admin),
--      writable ONLY by Owner/Admin. The seed Owner/Admin insert in
--      SETUP.md §3 still works because it runs in the SQL editor as
--      the table owner, which bypasses RLS.
--   5. Locks audit_log down: INSERT only for a recognised operator
--      role (a profile-less or unknown-role caller cannot forge audit
--      rows), SELECT only for Owner/Admin and Accountant, and NO
--      UPDATE / DELETE policy at all (append-only).
--   6. Grants SELECT / INSERT / UPDATE to authenticated on the finance
--      tables (audit_log gets SELECT / INSERT only, and any UPDATE /
--      DELETE grant it picked up from the base migration is revoked
--      here as belt-and-braces for append-only).
--
-- No DELETE policy is created for any table in this file: no finance
-- or payroll action deletes rows (reversals flip status), so DELETE is
-- denied everywhere here even for writers.
--
-- This migration is idempotent (DROP POLICY IF EXISTS before each
-- CREATE POLICY) and can be re-run. It does NOT touch data.
--
-- NOT VERIFIED HERE: there is no live database in this workspace, so
-- these policies and GRANTs have never been executed against a real
-- project. Before go-live, apply them to the live project and verify
-- with the checks in SETUP.md §2 — in particular, sign in as a
-- low-privilege operator and confirm that a direct PostgREST
-- UPDATE on profiles fails, and confirm effective GRANTs.
-- ============================================================================

-- --- Drop the old "authenticated full" policies -----------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'cash_accounts', 'app_settings', 'expense_categories',
    'purchases', 'purchase_items', 'purchase_returns', 'purchase_return_items',
    'customer_invoices', 'invoice_lines', 'customer_receipts',
    'invoice_allocations', 'vendor_payments', 'payment_allocations',
    'cash_transfers', 'party_ledger', 'bardana_ledger', 'attendance',
    'payroll_periods', 'payroll_payments', 'employee_advances',
    'opening_balances'
  ] loop
    execute format(
      'drop policy if exists "authenticated full via server actions" on public.%I', t);
  end loop;
end $$;

drop policy if exists "authenticated insert audit" on public.audit_log;
drop policy if exists "authenticated read audit" on public.audit_log;

-- --- SELECT: any signed-in operator (business tables) ------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'cash_accounts', 'app_settings', 'expense_categories',
    'purchases', 'purchase_items', 'purchase_returns', 'purchase_return_items',
    'customer_invoices', 'invoice_lines', 'customer_receipts',
    'invoice_allocations', 'vendor_payments', 'payment_allocations',
    'cash_transfers', 'party_ledger', 'bardana_ledger', 'attendance',
    'payroll_periods', 'payroll_payments', 'employee_advances',
    'opening_balances'
  ] loop
    execute format('drop policy if exists "select authenticated" on public.%I', t);
    execute format(
      'create policy "select authenticated" on public.%I for select ' ||
      'using (auth.role() = ''authenticated'')', t);
  end loop;
end $$;

-- --- Finance writes: Owner/Admin, Accountant ----------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'cash_accounts', 'expense_categories', 'purchases', 'purchase_items',
    'purchase_returns', 'purchase_return_items', 'customer_invoices',
    'invoice_lines', 'customer_receipts', 'invoice_allocations',
    'vendor_payments', 'payment_allocations', 'cash_transfers',
    'party_ledger', 'bardana_ledger', 'opening_balances'
  ] loop
    execute format('drop policy if exists "insert finance writers" on public.%I', t);
    execute format(
      'create policy "insert finance writers" on public.%I for insert ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''accountant''))', t);
    execute format('drop policy if exists "update finance writers" on public.%I', t);
    execute format(
      'create policy "update finance writers" on public.%I for update ' ||
      'using (public.current_app_role() in (''owner_admin'', ''accountant'')) ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''accountant''))', t);
  end loop;
end $$;

-- --- Payroll writes -------------------------------------------------------------
-- Attendance and advances are Owner/Admin + HR/payroll (the payroll
-- write gate). Payroll periods and payments additionally allow
-- Accountant, because the payroll-pay gate includes Accountant and
-- paying a run writes both tables.
do $$
declare
  t text;
begin
  foreach t in array array['attendance', 'employee_advances'] loop
    execute format('drop policy if exists "insert payroll writers" on public.%I', t);
    execute format(
      'create policy "insert payroll writers" on public.%I for insert ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''hr_payroll''))', t);
    execute format('drop policy if exists "update payroll writers" on public.%I', t);
    execute format(
      'create policy "update payroll writers" on public.%I for update ' ||
      'using (public.current_app_role() in (''owner_admin'', ''hr_payroll'')) ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''hr_payroll''))', t);
  end loop;
  foreach t in array array['payroll_periods', 'payroll_payments'] loop
    execute format('drop policy if exists "insert payroll pay writers" on public.%I', t);
    execute format(
      'create policy "insert payroll pay writers" on public.%I for insert ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''hr_payroll'', ''accountant''))', t);
    execute format('drop policy if exists "update payroll pay writers" on public.%I', t);
    execute format(
      'create policy "update payroll pay writers" on public.%I for update ' ||
      'using (public.current_app_role() in (''owner_admin'', ''hr_payroll'', ''accountant'')) ' ||
      'with check (public.current_app_role() in (''owner_admin'', ''hr_payroll'', ''accountant''))', t);
  end loop;
end $$;

-- --- Settings: Owner/Admin only --------------------------------------------------
-- The only settings writer in the app is updatePayrollRules, which is
-- already Owner/Admin-only at the action layer.
drop policy if exists "insert owner_admin" on public.app_settings;
create policy "insert owner_admin" on public.app_settings
  for insert with check (public.current_app_role() = 'owner_admin');

drop policy if exists "update owner_admin" on public.app_settings;
create policy "update owner_admin" on public.app_settings
  for update
  using (public.current_app_role() = 'owner_admin')
  with check (public.current_app_role() = 'owner_admin');

-- --- Profiles: the B3 fix ---------------------------------------------------------
-- SELECT: the operator's own row, or any row for Owner/Admin (listProfiles
-- and setUserRole read other operators' rows and are Owner/Admin-only
-- at the action layer). INSERT / UPDATE: Owner/Admin only — this is
-- what stops the privilege-escalation path. No DELETE policy.
-- current_app_role() is SECURITY DEFINER, so evaluating the admin
-- branch does not recurse into this policy.
drop policy if exists "select self or owner_admin" on public.profiles;
create policy "select self or owner_admin" on public.profiles
  for select using (
    id = auth.uid() or public.current_app_role() = 'owner_admin');

drop policy if exists "insert owner_admin" on public.profiles;
create policy "insert owner_admin" on public.profiles
  for insert with check (public.current_app_role() = 'owner_admin');

drop policy if exists "update owner_admin" on public.profiles;
create policy "update owner_admin" on public.profiles
  for update
  using (public.current_app_role() = 'owner_admin')
  with check (public.current_app_role() = 'owner_admin');

-- --- Audit log: append-only, restricted --------------------------------------------
-- INSERT: any recognised operator role (current_app_role() not null).
-- logAudit is called from gated server actions, so a legitimate actor
-- always has a role; a profile-less account cannot forge rows.
-- SELECT: Owner/Admin and Accountant only (B3: audit rows were readable
-- by anyone with an account). No UPDATE / DELETE policy.
drop policy if exists "insert recognised operator" on public.audit_log;
create policy "insert recognised operator" on public.audit_log
  for insert with check (public.current_app_role() is not null);

drop policy if exists "select owner_admin_accountant" on public.audit_log;
create policy "select owner_admin_accountant" on public.audit_log
  for select using (public.current_app_role() in ('owner_admin', 'accountant'));

-- --- GRANTs --------------------------------------------------------------------------
-- RLS policies are the enforcement layer; these grants only make the
-- tables reachable for the authenticated role. audit_log deliberately
-- gets SELECT / INSERT only, and any UPDATE / DELETE grant from the
-- base migration is revoked here. VERIFY LIVE in the real project.
grant select, insert, update on public.cash_accounts to authenticated;
grant select, insert, update on public.app_settings to authenticated;
grant select, insert, update on public.expense_categories to authenticated;
grant select, insert, update on public.purchases to authenticated;
grant select, insert, update on public.purchase_items to authenticated;
grant select, insert, update on public.purchase_returns to authenticated;
grant select, insert, update on public.purchase_return_items to authenticated;
grant select, insert, update on public.customer_invoices to authenticated;
grant select, insert, update on public.invoice_lines to authenticated;
grant select, insert, update on public.customer_receipts to authenticated;
grant select, insert, update on public.invoice_allocations to authenticated;
grant select, insert, update on public.vendor_payments to authenticated;
grant select, insert, update on public.payment_allocations to authenticated;
grant select, insert, update on public.cash_transfers to authenticated;
grant select, insert, update on public.party_ledger to authenticated;
grant select, insert, update on public.bardana_ledger to authenticated;
grant select, insert, update on public.attendance to authenticated;
grant select, insert, update on public.payroll_periods to authenticated;
grant select, insert, update on public.payroll_payments to authenticated;
grant select, insert, update on public.employee_advances to authenticated;
grant select, insert, update on public.opening_balances to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.audit_log to authenticated;
revoke update, delete on public.audit_log from authenticated;
