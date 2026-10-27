-- ============================================================================
-- Attachments, reference-based only (wave 2). A voucher may carry the URL
-- of a document stored elsewhere plus a short note — never a required
-- field, never an upload. NO storage buckets and NO storage policies are
-- created here, deliberately, so this migration does not touch the role
-- system or any existing RLS migration.
--
-- Apply AFTER supabase/schema.sql. Idempotent: every ALTER uses
-- IF NOT EXISTS, so the file can be re-run safely.
-- ============================================================================

ALTER TABLE public.incoming_goods
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE public.incoming_goods
  ADD COLUMN IF NOT EXISTS attachment_note TEXT;
ALTER TABLE public.gate_passes
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE public.gate_passes
  ADD COLUMN IF NOT EXISTS attachment_note TEXT;
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS attachment_note TEXT;
