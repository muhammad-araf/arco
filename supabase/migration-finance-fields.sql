-- ============================================================================
-- Finance field additions (spec §11, §12) — finance team.
--
-- Apply AFTER supabase/schema.sql and supabase/schema-finance.sql.
-- Idempotent (ADD COLUMN IF NOT EXISTS); re-runnable.
--
-- - customer_receipts.purpose: optional free text, what the receipt is
--   for; shown on the receipt print.
-- - customer_receipts.received_by: optional, who received the money;
--   shown on the receipt print signature line.
-- - expenses.location: optional, where the expense was incurred
--   (godown, site, ...). No behaviour change to posting.
--
-- NOT VERIFIED HERE: no live database in this workspace. Before
-- go-live, apply to the live project; until then the new action inputs
-- (createReceipt purpose/receivedBy, createExpense location) will fail
-- on insert because the columns do not exist yet.
-- ============================================================================

ALTER TABLE customer_receipts
  ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE customer_receipts
  ADD COLUMN IF NOT EXISTS received_by TEXT;
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS location TEXT;
