-- ============================================================================
-- Speed migration: DB-side aggregates for the daybook prior-history scan
-- and the dashboard party-balance fetch.
--
-- NOT APPLIED BY THE AGENT. This file is NOT applied automatically: it
-- must be applied in the Supabase SQL editor at go-live, in the order
-- the coordinator records in SETUP.md. Until it is applied, the app
-- keeps working unchanged: getDaybook() and getDashboardData() try
-- these functions first and fall back to the old full-row scans ONLY
-- when the RPC errors (e.g. function not found because this migration
-- was never applied). The fallbacks are interim and produce identical
-- figures; they may be removed once the migration is confirmed live.
--
-- IDEMPOTENT: both functions use CREATE OR REPLACE and the grants are
-- re-runnable, so applying this file twice is safe.
--
-- Security: plain LANGUAGE sql (invoker rights, NOT security definer) —
-- RLS on cash_ledger / party_ledger, if enabled, applies exactly as it
-- does to a direct select, following the migration-stock-summary-rpc.sql
-- precedent. No data change: both functions are read-only aggregates.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- cash_openings(p_before): per (cash_account_id, account) prior movement.
--
-- Replaces getDaybook()'s unbounded prior-history query:
--   cash_ledger .select("debit, credit, cash_account_id, account")
--     .lt("date", from)          -- plus an account/accountId filter
--   ... then a per-row JS accumulation into per-account groups.
--
-- Why the (cash_account_id, account) grain, not one row per account?
-- getDaybook() filters the prior scan by the ledger `account` column
-- for kind views (eq("account", kind)) but groups by cash_account_id
-- (falling back to kind:<account> for NULL-account rows). Returning
-- the pair grain lets the caller re-apply exactly those filters in JS:
--   - all view:   every pair, grouped by cash_account_id (or kind:<account>
--                 when cash_account_id is NULL) — identical to no filter.
--   - kind view:  only pairs with account = kind — identical to
--                 eq("account", kind).
--   - accountId view: only pairs with cash_account_id = accountId —
--                 identical to eq("cash_account_id", accountId).
-- The caller adds each pair's delta to its group with roundMoney(),
-- exactly as the old per-row loop did.
--
-- Figure-identical by construction: debit / credit are NUMERIC(15,2),
-- so every stored value already has at most 2 decimals and the exact
-- decimal sum rounded to 2dp equals the old per-row rounded
-- accumulation. A pair row is emitted even when its net delta is 0,
-- so groups that only existed because a prior row mentioned them
-- (net-zero history) are still created, as in the old loop.
--
-- Date bound: p_before is the same plain YYYY-MM-DD string getDaybook()
-- passes to .lt("date", from); casting it to timestamptz reproduces
-- PostgREST's comparison (midnight UTC at the start of that day).
-- cash_ledger.date is TIMESTAMPTZ, so rows dated on `from` itself are
-- excluded from the opening, exactly as before.
-- ---------------------------------------------------------------------------
create or replace function public.cash_openings(p_before text)
returns table (
  cash_account_id uuid,
  account text,
  opening_delta numeric
)
language sql
stable
as $$
  select
    cash_account_id,
    account,
    round(sum(debit - credit)::numeric, 2) as opening_delta
  from public.cash_ledger
  where date < p_before::timestamptz
  group by cash_account_id, account;
$$;

grant execute on function public.cash_openings(text) to authenticated;

-- ---------------------------------------------------------------------------
-- party_latest_balances(): latest running_balance per party.
--
-- Replaces getDashboardData()'s unbounded fetch:
--   party_ledger .select("party_id, running_balance, created_at")
--     .order("created_at", { ascending: true })
--   ... then a JS Map overwrite per party, so the LAST row in ascending
--   created_at order wins for each party.
--
-- DISTINCT ON with created_at DESC picks that same row: the maximum
-- created_at per party. One documented tie caveat: the old query
-- ordered by created_at ONLY, so when two rows for one party share an
-- identical created_at (microsecond precision, TIMESTAMPTZ NOT NULL
-- DEFAULT NOW()), the old winner was whichever row Postgres happened
-- to return last — unspecified by the query, not a stable figure. The
-- id DESC tiebreak below makes that case deterministic instead of
-- leaving it to plan shape; it does NOT mean "latest inserted"
-- (party_ledger.id is uuid_generate_v4(), i.e. random). Any figure
-- difference is confined to that exact-tie case, and only when the
-- tied rows also carry different running_balances.
--
-- The caller only reads party_id / running_balance (partyReceivables-
-- Payables ignores created_at), so the returned columns are exactly
-- what the dashboard math consumes. Receivables/payables math, the
-- master-opening fallback for parties with no ledger rows, and the
-- FINANCE_READ_SENSITIVE gate are all untouched in dashboard.ts.
-- ---------------------------------------------------------------------------
create or replace function public.party_latest_balances()
returns table (
  party_id uuid,
  running_balance numeric
)
language sql
stable
as $$
  select distinct on (party_id)
    party_id,
    running_balance
  from public.party_ledger
  order by party_id, created_at desc, id desc;
$$;

grant execute on function public.party_latest_balances() to authenticated;
