-- ============================================================================
-- Speed migration: single-RPC payload for the dashboard's fast sections.
--
-- NOT APPLIED BY THE AGENT. This file is NOT applied automatically: it
-- must be applied in the Supabase SQL editor at go-live, in the order
-- the coordinator records in SETUP.md. Until it is applied, the app
-- keeps working unchanged: getDashboardFast() / getDashboardData() try
-- this function first and fall back to the old per-table queries ONLY
-- when the RPC errors (e.g. function not found because this migration
-- was never applied). The fallbacks are interim and produce identical
-- figures; they may be removed once the migration is confirmed live.
--
-- IDEMPOTENT: CREATE OR REPLACE plus a re-runnable grant, so applying
-- this file twice is safe.
--
-- Security: plain LANGUAGE sql (invoker rights, NOT security definer) —
-- RLS on incoming_goods / production_batches / gate_passes / godowns /
-- parties / party_ledger / cash_accounts, if enabled, applies exactly
-- as it does to a direct select, following the
-- migration-stock-summary-rpc.sql and
-- migration-speed-party-cash-openings.sql precedents. No data change:
-- this function is a read-only aggregate. It performs NO role check
-- itself; the caller (dashboard.ts) passes p_include_finance = false
-- for roles outside Owner/Admin + Accountant, exactly as the old code
-- skipped the finance queries for those roles. A direct RPC call with
-- p_include_finance = true sees no more than a direct PostgREST
-- select on the same tables would.
--
-- What it replaces (app/actions/dashboard.ts, old getDashboardData
-- fan-out): the posted-today rows for incoming_goods,
-- production_batches and gate_passes, the latest posted gate pass,
-- the godown list, the party receivables/payables totals and the
-- cash-opening sum — 8 round trips collapsed into 1.
--
-- Deliberately NOT in this function (left on the old path in
-- dashboard.ts, see the per-field notes there):
--   - stock summary: getStockSummary() merges migration opening rows
--     (opening_balances kind 'stock') and resolves godown / product /
--     party names in JS; re-implementing that merge in SQL could not
--     be proven identical without a live database to test against.
--   - recent stock ledger (limit 20, select *): the page reads many
--     columns; a jsonb re-shape risks dropping a column the page
--     reads, for a saving of one cheap limited query.
--   - daybook cash position / per-account balances: getDaybook()
--     folds master openings, opening_balances evidence, legacy
--     kind:<kind> groups and inactive-account edge cases into its
--     closing figure; that logic is not re-implemented here.
--   - payroll due: getUnpaidSalaries() is a single cheap query whose
--     failure semantics (null, not a page failure) are load-bearing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- dashboard_today_payload(p_include_finance): the dashboard's fast
-- payload in one round trip.
--
-- Field-by-field equivalence with the old queries (all predicates
-- copied verbatim from dashboard.ts):
--
-- - inward_today: incoming_goods WHERE status = 'posted' AND
--   date >= UTC-today 00:00 AND date < UTC-tomorrow 00:00, columns
--   status / date / total_net_weight_kg / total_bags. The old code
--   built that window on the app server from new Date().toISOString();
--   here it is built on the DB server from now() AT TIME ZONE 'UTC'.
--   The two windows agree unless the app and DB clocks disagree
--   across a UTC-midnight boundary (a pre-existing cross-server
--   boundary; each call still uses one consistent window).
--   date is TIMESTAMPTZ in schema.sql, so the timestamptz bounds
--   compare exactly as the old PostgREST gte/lt on ISO strings did.
--   Rows are returned, NOT pre-summed: the page's reduce math runs
--   unchanged on identical rows, so no rounding question arises for
--   these fields. The old queries had NO ORDER BY and the page only
--   reduces (sums / counts); jsonb_agg likewise imposes no order,
--   and display formatting rounds to 2dp, so row order cannot change
--   any displayed figure.
-- - batches_today / passes_today: same window and status predicate,
--   same columns as the old selects.
-- - latest_pass_no: gate_passes WHERE status = 'posted' ORDER BY
--   date DESC, created_at DESC LIMIT 1 — the old PostgREST order,
--   key for key. Tie caveat: rows tied on BOTH date and created_at
--   had no specified winner in the old query either (no third key),
--   so this query is identically unspecified there, not more so.
-- - godowns: id / name / capacity_metric_tons ORDER BY code ASC —
--   the old select and order, key for key (code is NOT NULL UNIQUE).
-- - receivables / payables: the old partyReceivablesPayables() math,
--   re-expressed in SQL over the latest running_balance per party
--   (DISTINCT ON created_at DESC, id DESC — the same pick as the
--   party_latest_balances() precedent) with the signed master
--   opening (payable openings negative) for parties with no ledger
--   rows, and the old type rules: customer counts positives only,
--   supplier / source count negatives only, both counts both ways,
--   a ledger party missing from masters counts by sign, any other
--   type counts nothing (unreachable for the party_type_enum, but
--   kept as ELSE 0 for parity). Rounding: running_balance and
--   opening_balance are NUMERIC(15,2), so every input has at most
--   2 decimals and the exact decimal sum rounded to 2dp equals the
--   old JS Math.round(sum * 100) / 100 over the same values.
--   Tie caveat (same as the party_latest_balances precedent): the
--   old JS overwrite picked the maximum created_at per party with
--   no tiebreak, so when two rows for one party share an identical
--   created_at the old winner was unspecified (plan-dependent); the
--   id DESC tiebreak here makes that case deterministic instead.
--   Any difference is confined to that exact-tie case, and only when
--   the tied rows carry different running_balances.
-- - cash_opening: sum(opening_balance) over ALL cash_accounts (the
--   old query had no is_active filter), NULL-safe to 0.
-- - When p_include_finance is false, the three finance scalars are
--   returned as NULL and the caller maps them to null, exactly as
--   the old code did for restricted roles.
-- - Timestamps inside the jsonb rows are produced by the same
--   timestamptz-to-text conversion a direct PostgREST select uses
--   (same session settings: the RPC runs inside PostgREST's call),
--   so the page's String(date).slice(0, 10) sees the same date part.
--   The page consumes only that date part (plus the numeric columns)
--   from these rows.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_today_payload(p_include_finance boolean)
returns table (
  inward_today jsonb,
  batches_today jsonb,
  passes_today jsonb,
  latest_pass_no text,
  godowns jsonb,
  receivables numeric,
  payables numeric,
  cash_opening numeric
)
language sql
stable
as $$
  with bounds as (
    select
      (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') as day_start,
      ((date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC') as day_end
  ),
  latest as (
    select distinct on (party_id)
      party_id,
      running_balance
    from public.party_ledger
    order by party_id, created_at desc, id desc
  ),
  balances as (
    select
      coalesce(
        l.running_balance,
        case
          when p.balance_type = 'payable' then -coalesce(p.opening_balance, 0)
          else coalesce(p.opening_balance, 0)
        end
      ) as balance,
      p.type as party_type
    from public.parties p
    full outer join latest l on l.party_id = p.id
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'status', status,
        'date', date,
        'total_net_weight_kg', total_net_weight_kg,
        'total_bags', total_bags
      )), '[]'::jsonb)
     from public.incoming_goods
     where status = 'posted'
       and date >= (select day_start from bounds)
       and date < (select day_end from bounds)),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'status', status,
        'date', date,
        'actual_output_kg', actual_output_kg,
        'yield_pct', yield_pct,
        'byproduct_kg', byproduct_kg,
        'waste_kg', waste_kg
      )), '[]'::jsonb)
     from public.production_batches
     where status = 'posted'
       and date >= (select day_start from bounds)
       and date < (select day_end from bounds)),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'status', status,
        'date', date,
        'total_weight_kg', total_weight_kg,
        'pass_no', pass_no
      )), '[]'::jsonb)
     from public.gate_passes
     where status = 'posted'
       and date >= (select day_start from bounds)
       and date < (select day_end from bounds)),
    (select pass_no
     from public.gate_passes
     where status = 'posted'
     order by date desc, created_at desc
     limit 1),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'capacity_metric_tons', capacity_metric_tons
      ) order by code asc), '[]'::jsonb)
     from public.godowns),
    case when p_include_finance then
      (select round(coalesce(sum(case
          when party_type is null and balance > 0 then balance
          when party_type = 'customer' and balance > 0 then balance
          when party_type = 'both' and balance > 0 then balance
          else 0 end), 0), 2)
       from balances)
    else null end,
    case when p_include_finance then
      (select round(coalesce(sum(case
          when party_type is null and balance < 0 then -balance
          when party_type in ('supplier', 'source') and balance < 0 then -balance
          when party_type = 'both' and balance < 0 then -balance
          else 0 end), 0), 2)
       from balances)
    else null end,
    case when p_include_finance then
      (select coalesce(sum(coalesce(opening_balance, 0)), 0)
       from public.cash_accounts)
    else null end
  from bounds;
$$;

grant execute on function public.dashboard_today_payload(boolean) to authenticated;
