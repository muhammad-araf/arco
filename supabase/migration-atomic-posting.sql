-- ============================================================================
-- Atomic posting (QA blocker B4): exact-once ledger writes.
-- Apply AFTER supabase/schema.sql, supabase/schema-finance.sql,
-- supabase/migration-stock-partial-returns.sql and the RLS migrations,
-- and BEFORE deploying the app code that calls atomic_stock_transition
-- (until this migration is applied, those post actions fail cleanly
-- with "function does not exist" and write nothing — they never
-- half-post). The migration is idempotent and can be re-run.
--
-- What it does, in two layers:
--   1. Ledger identity: every ledger row carries the identity of the
--      logical line it records, and a unique index rejects a second
--      copy of the same line. A duplicate insert therefore FAILS
--      instead of silently duplicating, and the app treats that
--      failure as "already written" on retry (see lib/idempotency.ts).
--   2. One-transaction posting: atomic_stock_transition() locks the
--      voucher row (FOR UPDATE, which serializes concurrent posts of
--      the same voucher), refuses a voucher that is no longer in a
--      postable status, inserts all ledger lines with sequential
--      running balances, flips the status, and stores the idempotency
--      key — all in ONE transaction, so a crash mid-post rolls the
--      whole post back and a retry starts clean.
--
-- SECURITY: the function is SECURITY INVOKER (the default, stated
-- explicitly). It runs with the caller's rights, so the RLS policies
-- from migration-rls-base-tables.sql still gate every insert and
-- update exactly as if the app had issued them directly. It adds no
-- privilege: a caller who cannot write stock_ledger through PostgREST
-- cannot write it through this function either. The voucher-table
-- argument is allowlisted — arbitrary tables cannot be passed.
--
-- Backfills: existing ledger rows get entry_kind from their notes
-- ("Reversal of …" / "Return of …" markers the app already writes)
-- and a distinct line_no per (voucher, kind) from row_number(), so
-- creating the unique indexes never fails on old data. Pre-existing
-- duplicate rows (posted twice before this migration) are NOT
-- deleted — they are history; the live-DB check in the Phase D report
-- lists how to spot them.
-- ============================================================================

-- --- 1a. stock_ledger identity -------------------------------------------
alter table public.stock_ledger
  add column if not exists entry_kind text not null default 'post';
alter table public.stock_ledger
  add column if not exists line_no integer not null default 0;

update public.stock_ledger
set entry_kind = case
  when notes ilike 'reversal of%' then 'reversal'
  when notes ilike 'return of%' then 'return'
  else 'post'
end;

update public.stock_ledger s
set line_no = ranked.rn - 1
from (
  select id,
    row_number() over (
      partition by voucher_type, voucher_id, entry_kind
      order by created_at nulls last, id
    ) as rn
  from public.stock_ledger
) ranked
where s.id = ranked.id;

create unique index if not exists ux_stock_ledger_identity
  on public.stock_ledger (voucher_type, voucher_id, entry_kind, line_no);

-- --- 1b. party_ledger identity -------------------------------------------
alter table public.party_ledger
  add column if not exists line_no integer not null default 0;

update public.party_ledger s
set line_no = ranked.rn - 1
from (
  select id,
    row_number() over (
      partition by voucher_type, voucher_id, entry_type
      order by created_at nulls last, id
    ) as rn
  from public.party_ledger
) ranked
where s.id = ranked.id;

create unique index if not exists ux_party_ledger_identity
  on public.party_ledger (voucher_type, voucher_id, entry_type, line_no);

-- --- 1c. cash_ledger identity --------------------------------------------
alter table public.cash_ledger
  add column if not exists line_no integer not null default 0;

update public.cash_ledger s
set line_no = ranked.rn - 1
from (
  select id,
    row_number() over (
      partition by voucher_type, voucher_id
      order by created_at nulls last, id
    ) as rn
  from public.cash_ledger
) ranked
where s.id = ranked.id;

create unique index if not exists ux_cash_ledger_identity
  on public.cash_ledger (voucher_type, voucher_id, line_no);

-- --- 1d. bardana_ledger identity ------------------------------------------
alter table public.bardana_ledger
  add column if not exists line_no integer not null default 0;

update public.bardana_ledger s
set line_no = ranked.rn - 1
from (
  select id,
    row_number() over (
      partition by voucher_type, voucher_id
      order by created_at nulls last, id
    ) as rn
  from public.bardana_ledger
) ranked
where s.id = ranked.id;

create unique index if not exists ux_bardana_ledger_identity
  on public.bardana_ledger (voucher_type, voucher_id, line_no);

-- --- 1e. payroll payments: stable token for payPayroll --------------------
-- A unique index (not a constraint) so multiple NULLs — payments
-- recorded before this migration — stay valid.
alter table public.payroll_payments
  add column if not exists client_token text;
create unique index if not exists ux_payroll_payments_client_token
  on public.payroll_payments (client_token);

-- --- 2. Atomic stock transition -------------------------------------------
-- p_lines is a JSON array of:
--   { line_no, godown_id, product_id, party_id | null,
--     inward_qty, outward_qty, notes | null }
-- p_from_statuses is the list of statuses the transition may start
-- from (post: ['draft']; gate-pass reverse: ['posted',
-- 'partially_returned']). p_to_status is the target status.
-- Returns jsonb: { outcome: 'transitioned' | 'already' | 'invalid',
--   status: <current/target status>, voucher: <voucher row json> }.
-- 'already' means the voucher is already in the target status: the
-- caller must treat it as a successful replay, never rewrite rows.
-- 'invalid' means the voucher is in an unrelated status: the caller
-- must fail with the returned status in the message.
create or replace function public.atomic_stock_transition(
  p_voucher_table text,
  p_voucher_id uuid,
  p_from_statuses text[],
  p_to_status text,
  p_voucher_type text,
  p_voucher_no text,
  p_entry_kind text,
  p_lines jsonb,
  p_created_by text,
  p_client_token text default null,
  p_scope text default null,
  p_reversal_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_line jsonb;
  v_pool_balance numeric;
  v_delta numeric;
  v_set text;
  v_voucher jsonb;
  v_stored jsonb;
  v_has boolean;
begin
  if p_voucher_table not in (
    'incoming_goods', 'gate_passes', 'godown_transfers',
    'stock_adjustments', 'machinery_jobs'
  ) then
    raise exception 'atomic_stock_transition: unsupported voucher table %', p_voucher_table;
  end if;

  -- Lock the voucher row first. A second concurrent transition of the
  -- same voucher blocks here until this transaction commits or rolls
  -- back, then re-reads the new status below — it can never pass a
  -- stale draft check while this post is in flight.
  execute format('select status from public.%I where id = $1 for update', p_voucher_table)
    into v_status using p_voucher_id;
  if v_status is null then
    raise exception 'voucher not found';
  end if;

  -- Already in the target status: replay, do not rewrite anything.
  if v_status = p_to_status then
    if p_client_token is not null and p_scope is not null then
      select result into v_stored from public.idempotency_keys
        where client_token = p_client_token and scope = p_scope;
      if found then
        return jsonb_build_object('outcome', 'already', 'status', v_status, 'voucher', v_stored);
      end if;
    end if;
    execute format(
      'select row_to_json(t)::jsonb from (select * from public.%I where id = $1) t',
      p_voucher_table
    ) into v_voucher using p_voucher_id;
    return jsonb_build_object('outcome', 'already', 'status', v_status, 'voucher', v_voucher);
  end if;

  if not (v_status = any (p_from_statuses)) then
    return jsonb_build_object('outcome', 'invalid', 'status', v_status);
  end if;

  -- Ledger lines, in order. Each insert sees the earlier inserts of
  -- this same transaction, so the running balance accumulates
  -- sequentially per (godown, product, owner) pool — no full-ledger
  -- scan per line from the app, and no stale-balance race.
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_delta := coalesce((v_line ->> 'inward_qty')::numeric, 0)
      - coalesce((v_line ->> 'outward_qty')::numeric, 0);
    select coalesce(sum(inward_qty - outward_qty), 0) into v_pool_balance
      from public.stock_ledger
      where godown_id = (v_line ->> 'godown_id')::uuid
        and product_id = (v_line ->> 'product_id')::uuid
        and party_id is not distinct from
          (case when v_line ->> 'party_id' is null then null
                else (v_line ->> 'party_id')::uuid end);
    insert into public.stock_ledger (
      voucher_type, voucher_id, voucher_no, godown_id, product_id,
      party_id, inward_qty, outward_qty, unit, running_balance,
      notes, created_by, entry_kind, line_no
    ) values (
      p_voucher_type, p_voucher_id::text, p_voucher_no,
      (v_line ->> 'godown_id')::uuid, (v_line ->> 'product_id')::uuid,
      (case when v_line ->> 'party_id' is null then null
            else (v_line ->> 'party_id')::uuid end),
      coalesce((v_line ->> 'inward_qty')::numeric, 0),
      coalesce((v_line ->> 'outward_qty')::numeric, 0),
      'kg', v_pool_balance + v_delta,
      (v_line ->> 'notes'), p_created_by, p_entry_kind,
      coalesce((v_line ->> 'line_no')::integer, 0)
    );
  end loop;

  -- Status flip plus whatever timestamp/reason columns this voucher
  -- table actually has (gate_passes records dispatched_at instead of
  -- posted_at; not every table has every column). Column checks keep
  -- one function working for all five allowlisted tables.
  v_set := 'status = ' || quote_literal(p_to_status);
  if p_to_status = 'posted' then
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = p_voucher_table
        and column_name = 'posted_at'
    ) into v_has;
    if v_has then v_set := v_set || ', posted_at = now()'; end if;
    if p_voucher_table = 'gate_passes' then
      select exists(
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = p_voucher_table
          and column_name = 'dispatched_at'
      ) into v_has;
      if v_has then v_set := v_set || ', dispatched_at = now()'; end if;
    end if;
  elsif p_to_status = 'reversed' then
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = p_voucher_table
        and column_name = 'reversed_at'
    ) into v_has;
    if v_has then v_set := v_set || ', reversed_at = now()'; end if;
    if p_reversal_reason is not null then
      select exists(
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = p_voucher_table
          and column_name = 'reversal_reason'
      ) into v_has;
      if v_has then v_set := v_set || ', reversal_reason = ' || quote_literal(p_reversal_reason); end if;
    end if;
  elsif p_to_status in ('returned', 'partially_returned') then
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = p_voucher_table
        and column_name = 'returned_at'
    ) into v_has;
    if v_has then v_set := v_set || ', returned_at = now()'; end if;
  end if;
  execute format('update public.%I set %s where id = $1', p_voucher_table, v_set)
    using p_voucher_id;

  execute format(
    'select row_to_json(t)::jsonb from (select * from public.%I where id = $1) t',
    p_voucher_table
  ) into v_voucher using p_voucher_id;

  -- Idempotency record, in the same transaction as the flip: a crash
  -- after this point has already committed the post, and a retry
  -- replays from this row (or from the 'already' status check above).
  -- ON CONFLICT (client_token, scope) is the table's real primary key;
  -- the old app upsert named only client_token, which Postgres
  -- rejects, so stored tokens silently never landed (see Phase D
  -- report). This insert is what makes replays work.
  if p_client_token is not null and p_scope is not null then
    insert into public.idempotency_keys (
      client_token, scope, voucher_type, voucher_id, voucher_no, result
    ) values (
      p_client_token, p_scope, p_voucher_type, p_voucher_id::text,
      p_voucher_no, v_voucher
    ) on conflict (client_token, scope) do nothing;
  end if;

  return jsonb_build_object(
    'outcome', 'transitioned', 'status', p_to_status, 'voucher', v_voucher
  );
end;
$$;

revoke execute on function public.atomic_stock_transition(
  text, uuid, text[], text, text, text, text, jsonb, text, text, text, text
) from public;
grant execute on function public.atomic_stock_transition(
  text, uuid, text[], text, text, text, text, jsonb, text, text, text, text
) to authenticated;
