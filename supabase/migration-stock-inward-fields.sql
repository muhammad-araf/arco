-- ============================================================================
-- Stock-dash inward fields (wave 2): columns the inward action already
-- writes tolerantly (see app/actions/inward.ts — it strips these fields
-- and warns when the live database lacks them, so posting never fails).
-- This migration completes that work; it invents no other columns.
--
-- Apply AFTER supabase/schema.sql. Idempotent: every ALTER uses
-- IF NOT EXISTS, so the file can be re-run safely.
-- ============================================================================

ALTER TABLE public.incoming_goods
  ADD COLUMN IF NOT EXISTS received_by TEXT;
ALTER TABLE public.incoming_goods
  ADD COLUMN IF NOT EXISTS by_hand BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.incoming_goods
  ADD COLUMN IF NOT EXISTS nature TEXT;
ALTER TABLE public.incoming_goods_items
  ADD COLUMN IF NOT EXISTS lot_no TEXT;
