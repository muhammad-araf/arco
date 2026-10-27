"use server";

import { getDb, requireRole, type ActionResult } from "./auth";

/**
 * Audit-log reads only. Writes stay in lib/audit.ts (logAudit) and are
 * imported by the other action files; this file never inserts, updates,
 * or deletes audit rows.
 *
 * Read gate follows the same requireRole pattern as the other actions:
 * Owner/Admin and Accountant only, matching the audit_log SELECT policy
 * (owner_admin/accountant) in the RLS migration. Every other role gets
 * the same fail-closed denial, never an empty-but-authorised list.
 */
export async function listAudit(filters: {
  userEmail?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, ["owner_admin", "accountant"]);
  if (!gate.ok) return { success: false, error: gate.error };
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 200);
  let q = db.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (filters.userEmail) q = q.ilike("user_email", `%${filters.userEmail}%`);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.entityType) q = q.eq("entity_type", filters.entityType);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59.999Z`);
  const { data, error: qError } = await q;
  if (qError) return { success: false, error: qError.message };
  return { success: true, data };
}
