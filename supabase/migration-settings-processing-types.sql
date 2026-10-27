-- Settings program: processing-types master + party/employee fields.
-- Apply at go-live alongside the other pending migrations. Idempotent
-- (IF NOT EXISTS / DO blocks), so re-applying it is safe.
--
-- 1. processing_types: the controlled list of processing types
--    (Grading, Drying, ...). Callers of listProcessingTypes() fall
--    back to free text while this table is empty, so seeding is
--    optional — an empty table is a valid starting state.
-- 2. parties.tax_id / parties.registration_no: nullable tax and
--    business-registration identifiers (e.g. NTN / STRN).
-- 3. employees.payment_preference: nullable payment preference
--    (e.g. cash / bank). Null means "not recorded", never a default.
--
-- RLS for the NEW table only (existing RLS migrations are untouched):
-- any signed-in operator may read; only owner_admin may insert or
-- update, mirroring the other masters tables; no DELETE policy, so
-- rows are deactivated, never deleted. The new party/employee columns
-- need no policy change — policies are table-level, not column-level.

create table if not exists public.processing_types (
  id uuid primary key default uuid_generate_v4(),
  name text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.parties
  add column if not exists tax_id text,
  add column if not exists registration_no text;

alter table public.employees
  add column if not exists payment_preference text;

alter table public.processing_types enable row level security;

drop policy if exists "select authenticated" on public.processing_types;
create policy "select authenticated" on public.processing_types
  for select using (auth.role() = 'authenticated');

drop policy if exists "insert owner_admin" on public.processing_types;
create policy "insert owner_admin" on public.processing_types
  for insert with check (public.current_app_role() = 'owner_admin');

drop policy if exists "update owner_admin" on public.processing_types;
create policy "update owner_admin" on public.processing_types
  for update
  using (public.current_app_role() = 'owner_admin')
  with check (public.current_app_role() = 'owner_admin');

grant select, insert, update on public.processing_types to authenticated;
