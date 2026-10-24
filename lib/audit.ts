/**
 * Append-only audit logging (spec §17).
 *
 * The audit_log table is INSERT/SELECT-only for authenticated users (see
 * supabase/schema-finance.sql) and server code here only ever INSERTs.
 * Posted transactions are never deleted: a cancel is a reversal row plus
 * an audit entry with a mandatory reason.
 *
 * logAudit never throws: a failed audit insert must not mask the business
 * result of the action that triggered it, but it is logged to the server
 * console so a missing audit trail is visible in deployment logs.
 */

type SupabaseLike = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  voucherNo?: string | null;
  /** JSON-safe before/after summaries (amounts, status, balances). */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Mandatory for post/cancel/reverse/return/export/permission changes. */
  reason?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Actions that must always carry a reason; callers enforce this. */
export const REASON_REQUIRED_ACTIONS = [
  "post",
  "cancel",
  "reverse",
  "return",
  "export",
  "permission_change",
  "attendance_correction",
  "payroll_adjustment",
] as const;

export async function logAudit(
  db: SupabaseLike,
  entry: AuditEntry,
): Promise<void> {
  try {
    const { error } = await db.from("audit_log").insert({
      user_id: entry.userId ?? null,
      user_email: entry.userEmail ?? null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      voucher_no: entry.voucherNo ?? null,
      before_summary: entry.before ?? null,
      after_summary: entry.after ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? null,
    });
    if (error) console.error("[audit] insert failed:", error);
  } catch (err) {
    console.error("[audit] insert threw:", err);
  }
}
