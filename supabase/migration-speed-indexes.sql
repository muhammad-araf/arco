-- ============================================================================
-- Speed migration: composite indexes for the slow scans in the speed report
--
-- NOT APPLIED BY THE AGENT — apply in the Supabase SQL editor at go-live,
-- AFTER supabase/schema.sql and supabase/schema-finance.sql (and the other
-- migrations in SETUP.md §2 order). Every statement is
-- CREATE INDEX IF NOT EXISTS, so the file is idempotent and safe to
-- re-run. No data change, no column change, no RLS change.
--
-- Why these, and what was deliberately NOT duplicated (checked against
-- schema.sql, schema-finance.sql and all existing migrations):
--   * stock_ledger already has (godown_id, product_id), (date),
--     (party_id) and (voucher_id) — but no index covers the
--     stock_summary GROUP BY (godown_id, product_id, party_id), so the
--     RPC and the JS fallback both seq-scan the whole ledger.
--   * cash_ledger already has single-column (date), (account) and
--     (cash_account_id) — but the daybook queries filter by account
--     AND a date range and order by date, so the composites below let
--     one index serve filter + range + order instead of a bitmap
--     combination plus sort.
--   * party_ledger already has (party_id, date), which covers the
--     party-statement query (party + date range + date order) — a
--     (party_id, created_at) index would near-duplicate it, so it is
--     NOT included. The dashboard's unfiltered party_ledger fetch
--     ordered by created_at is a separate query-shape problem, not
--     fixed by a party-first index.
--   * gate_passes already has (status) and (date); production_batches
--     already has (status) and (recipe_id). The composites below add
--     the FK + date combinations the list filters actually use.
--   * gate_passes.vehicle_no is filtered with ILIKE '%…%' — a btree
--     index cannot serve a leading-wildcard match, so no vehicle index
--     is included (that would need pg_trgm, out of scope here).
--   * Postgres scans an ASC index backwards for DESC ordering, so no
--     separate DESC copies of the date indexes are needed.
-- ============================================================================

-- 1. stock_summary RPC GROUP BY + JS fallback full aggregation:
--    grouped sum over (godown, product, party). INCLUDE makes the
--    aggregation an index-only scan (no heap fetch per ledger row).
CREATE INDEX IF NOT EXISTS idx_stock_ledger_summary
  ON stock_ledger (godown_id, product_id, party_id)
  INCLUDE (inward_qty, outward_qty);

-- 2. Daybook cash_ledger scans (finance.ts getCashLedger / getDaybook):
--    prior-balance scan (account filter + date < from) and window scan
--    (account filter + date range + date order), for both the
--    cash_account_id and the account-kind variants.
CREATE INDEX IF NOT EXISTS idx_cash_ledger_account_id_date
  ON cash_ledger (cash_account_id, date);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_account_date
  ON cash_ledger (account, date);

-- 3. Gate-pass register list filters (gatepass.ts listGatePasses):
--    customer / godown filter combined with the date ordering and
--    date-range filters. (status) and (date) already exist.
CREATE INDEX IF NOT EXISTS idx_gate_passes_customer_date
  ON gate_passes (customer_id, date);
CREATE INDEX IF NOT EXISTS idx_gate_passes_godown_date
  ON gate_passes (godown_id, date);

-- 4. Production batch register list filters (production.ts listBatches):
--    date ordering / date-range filters, and godown filter + date.
--    (status) and (recipe_id) already exist.
CREATE INDEX IF NOT EXISTS idx_batches_date
  ON production_batches (date);
CREATE INDEX IF NOT EXISTS idx_batches_godown_date
  ON production_batches (godown_id, date);

-- 5. Nested line joins that remain after the list trims: the single
--    getBatch / getGatePass / listRecipes detail fetches join these
--    child tables by their parent id, and none of them had an index
--    on the FK column (gate_pass_items(gate_pass_id) already exists).
CREATE INDEX IF NOT EXISTS idx_production_batch_inputs_batch
  ON production_batch_inputs (batch_id);
CREATE INDEX IF NOT EXISTS idx_production_batch_outputs_batch
  ON production_batch_outputs (batch_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe
  ON recipe_items (recipe_id);
