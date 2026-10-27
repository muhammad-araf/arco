-- ============================================================================
-- Gate pass spec §9 gaps: receiver fields, dispatch mode, prepared /
-- approved-by, approval workflow status, return condition + restock
-- decision, and per-line bag type.
-- Apply AFTER supabase/schema.sql (order relative to the other
-- migrations does not matter, except: run the ALTER TYPE statement on
-- its own first — ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction block, and some SQL editors wrap the whole file in one.
--
-- Approval workflow (spec §9.3 step 4) is SETTING-GATED: the
-- `gatepass_approval_required` app_settings row is owned by the
-- settings team; when it is absent the action code treats approval as
-- OFF and posting behaves exactly as before (draft -> posted). When
-- it is ON, posting moves a pass to `awaiting_approval` with NO stock
-- change; only approveGatePass (owner_admin, interim — the client
-- has not yet defined who approves under §19) deducts stock.
-- No new role is introduced here.
-- ============================================================================

-- New status for the approval workflow. Shared voucher_status_enum,
-- same pattern as migration-stock-partial-returns.sql.
ALTER TYPE voucher_status_enum ADD VALUE IF NOT EXISTS 'awaiting_approval';

-- Receiver, dispatch mode, and sign-off names on the pass itself.
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS receiver_name TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS receiver_contact TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS dispatch_mode TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS prepared_by TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS approved_by TEXT;
-- Reason recorded when an awaiting_approval pass is rejected back to draft.
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Return condition + restock decision on each return row. Both
-- nullable: rows written before this migration restocked unconditionally.
-- restock_decision is 'accepted' (quantity returns to stock) or
-- 'rejected' (quantity is recorded but never returns to stock).
ALTER TABLE gate_pass_returns ADD COLUMN IF NOT EXISTS condition TEXT;
ALTER TABLE gate_pass_returns ADD COLUMN IF NOT EXISTS restock_decision TEXT
  CHECK (restock_decision IS NULL OR restock_decision IN ('accepted', 'rejected'));

-- Bag type per dispatched line.
ALTER TABLE gate_pass_items ADD COLUMN IF NOT EXISTS packaging_type_id UUID
  REFERENCES packaging_types(id) ON DELETE SET NULL;

-- Duplicate order-reference lookups (warning only, never a block).
CREATE INDEX IF NOT EXISTS idx_gate_passes_order_ref ON gate_passes(order_ref);
