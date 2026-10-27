-- ============================================================================
-- Stock fix: gate-pass partial returns
-- Apply AFTER supabase/schema.sql (order relative to the RLS migrations
-- does not matter). This migration adds NO new quantity columns:
-- gate_pass_returns already records every return per (product, owner)
-- pool, and that table is the source of truth for cumulative returns.
-- The pass status is derived from it: "partially_returned" while any
-- dispatched quantity remains unreturned, "returned" only when the full
-- dispatched quantity is back.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- If the SQL editor reports that error, run this one statement on its
-- own (outside any BEGIN/COMMIT wrapper).
-- ============================================================================

ALTER TYPE voucher_status_enum ADD VALUE IF NOT EXISTS 'partially_returned';
