"use server";

import { getDb, requireRole, type ActionResult } from "./auth";
import { PRODUCTION_WRITE } from "./auth-helpers";
import {
  writeCostLedgerRows,
  type CostLedgerEntry,
} from "@/lib/cost-ledger";

/**
 * Record production cost rows (wave 2, gated).
 *
 * Server action wrapper around the plain helper in lib/cost-ledger.ts
 * (the helper itself cannot live here: a "use server" module may only
 * export async functions, and postBatch / postJob import the helper
 * directly). Writes are production-writer gated via the existing
 * requireRole helper and existing role constants — no role logic is
 * modified. When cost_ledger_enabled is off, nothing is written and
 * the call succeeds with data { written: false }.
 */
export async function recordProductionCost(
  entries: CostLedgerEntry[],
): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, PRODUCTION_WRITE);
  if (!gate.ok) return { success: false, error: gate.error };
  const res = await writeCostLedgerRows(
    db as unknown as Parameters<typeof writeCostLedgerRows>[0],
    entries,
  );
  if (res.error) return { success: false, error: res.error };
  return { success: true, data: { written: res.ok, rows: entries.length } };
}
