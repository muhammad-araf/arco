-- ============================================================================
-- Performance migration: DB-side stock summary aggregate
-- Apply AFTER supabase/schema.sql (and schema-finance.sql) in the Supabase
-- SQL editor. OPTIONAL but strongly recommended: getStockSummary() prefers
-- this function and falls back to the old whole-ledger JS aggregation when
-- it is missing, so the app works with or without it — it is just much
-- faster with it (one grouped sum instead of shipping every ledger row).
--
-- Result-identical by construction: every ledger writer in the app rounds
-- quantities to 2dp on write (see roundWeight call sites in
-- app/actions/inward.ts, inventory.ts, production.ts, gatepass.ts), so the
-- exact decimal sum rounded to 2dp here equals the old per-row rounded
-- accumulation. If any legacy rows carry more than 2dp, balances could
-- differ by a cent for those groups — check with:
--   select count(*) from stock_ledger
--   where inward_qty <> round(inward_qty, 2) or outward_qty <> round(outward_qty, 2);
-- and round those rows before relying on the RPC.
--
-- Security: plain LANGUAGE sql (invoker rights) — RLS on stock_ledger, if
-- enabled, applies exactly as it does to a direct select. No data change.
-- ============================================================================

create or replace function public.stock_summary()
returns table (
  godown_id uuid,
  product_id uuid,
  party_id uuid,
  balance_kg numeric
)
language sql
stable
as $$
  select
    godown_id,
    product_id,
    party_id,
    round(sum(inward_qty - outward_qty)::numeric, 2) as balance_kg
  from public.stock_ledger
  group by godown_id, product_id, party_id;
$$;

grant execute on function public.stock_summary() to authenticated;
