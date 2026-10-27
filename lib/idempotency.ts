/**
 * Idempotency tokens (QA blocker B4).
 *
 * Two token shapes, and they must not be mixed up:
 *
 * - postToken(scope, voucherId): DETERMINISTIC, for actions on an
 *   existing voucher (post / reverse / retry-post). The same voucher
 *   always yields the same token, so a double-click, a retry button,
 *   or a refresh replays the original transition instead of creating
 *   a second one. Never put Date.now() in these.
 * - submissionToken(ref, prefix): for create actions (receipt,
 *   invoice, expense, transfer, purchase, payment, payroll pay,
 *   gate-pass return), where no voucher id exists yet. The token is
 *   created ONCE per form submission — lazily, on the first submit
 *   attempt — and held in a ref, so a double-click reuses it and the
 *   server's byToken check returns the existing document. The page
 *   MUST call resetSubmissionToken(ref) after a successful submit,
 *   or the next, different submission would replay the first one.
 */

/** Deterministic token for a transition of an existing voucher. */
export function postToken(scope: string, voucherId: string): string {
  return `${scope}-${voucherId}`;
}

/** A fresh random token for one form submission. */
export function newSubmissionToken(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}

/**
 * The submission token for this form instance, creating it on the
 * first submit attempt and reusing it on every later attempt (retry
 * or double-click) until resetSubmissionToken() runs.
 */
export function submissionToken(
  ref: { current: string | null },
  prefix: string,
): string {
  if (!ref.current) ref.current = newSubmissionToken(prefix);
  return ref.current;
}

/** Clear a submission token after a successful submit. */
export function resetSubmissionToken(ref: { current: string | null }): void {
  ref.current = null;
}

/**
 * True when a PostgREST/supabase error is a unique-constraint
 * violation (Postgres 23505). Ledger helpers treat this as "this
 * exact line is already written" and skip it, which is what makes a
 * retry after a crash converge instead of failing on its own rows.
 * The identity indexes are in supabase/migration-atomic-posting.sql;
 * a 23505 on one of those indexes can only mean the same logical
 * line (same voucher, kind, line number), never a different line.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes("23505");
}
