"use server";

import { getDb, requireSignedIn, type ActionResult } from "./auth";

/**
 * Read-only viewer for the production cost ledger (table
 * `production_cost_ledger`, see supabase/migration-production-cost-ledger.sql).
 *
 * This is the only action in this file, and it only READS. The write path
 * (recordProductionCost in app/actions/cost-ledger.ts, gated behind the
 * cost_ledger_enabled setting) is untouched: no rows are created, updated
 * or deleted here, and the gate is not read or changed here either. When
 * the gate is off the table is simply empty, so an empty result means
 * "nothing posted yet", not an error.
 *
 * Reads are open to any signed-in operator, the same rule as the other
 * ledger reads (stock ledger, bardana ledger) — see app/actions/auth.ts.
 */
export async function listProductionCostLedger(filters?: {
  costType?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  try {
    const limit = Math.min(Math.max(filters?.limit ?? 500, 1), 1000);
    let query = db
      .from("production_cost_ledger")
      .select("id, batch_id, job_id, cost_type, amount, qty_kg, basis, recorded_at, created_at")
      .order("recorded_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (filters?.costType) query = query.eq("cost_type", filters.costType);
    if (filters?.from) query = query.gte("recorded_at", filters.from);
    // A plain YYYY-MM-DD `to` date covers the whole day: compare against
    // the next day (exclusive), the same bound the other ledger reads use.
    if (filters?.to) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
        const d = new Date(`${filters.to}T00:00:00Z`);
        if (!Number.isNaN(d.getTime())) {
          d.setUTCDate(d.getUTCDate() + 1);
          query = query.lt("recorded_at", d.toISOString());
        }
      } else {
        query = query.lte("recorded_at", filters.to);
      }
    }
    const { data, error: qError } = await query;
    if (qError) return { success: false, error: qError.message };
    const rows = data ?? [];
    const totalAmount = rows.reduce(
      (sum: number, r: Record<string, unknown>) => sum + (Number(r.amount) || 0),
      0,
    );
    return { success: true, data: { rows, totalAmount } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not load the cost ledger.",
    };
  }
}
