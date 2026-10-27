"use server";

/**
 * Dashboard aggregate (speed): one signed-in check and one browser round
 * trip for everything the dashboard shows, instead of nine separate server
 * actions (nine auth checks, five full-table fetches with nested line
 * items). Every query below returns exactly the columns the dashboard
 * page reads, and the page's own filtering/math is unchanged:
 *
 * - "today" means the UTC calendar day, matching the page's previous
 *   client-side check (ISO date slice). Rows are filtered to posted
 *   status server-side for the same reason.
 * - Receivables/payables use the page's exact expression:
 *   balance_amount ?? (total_amount - paid_amount).
 * - Stock summary and the recent ledger reuse getStockSummary() /
 *   getStockLedger() verbatim, so their numbers cannot drift.
 * - Latest pass: the first posted pass in date-desc order. The page
 *   previously picked the first posted row of the full date-desc list;
 *   created_at breaks same-date ties deterministically here.
 */

import { getDb, requireRole, requireSignedIn, type ActionResult } from "./auth";
import { getStockSummary, getStockLedger } from "./inventory";
import { errMsg, FINANCE_READ_SENSITIVE } from "./auth-helpers";

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** UTC day window [today 00:00Z, tomorrow 00:00Z). */
function utcDayRange(): { start: string; end: string } {
  const start = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86400000).toISOString();
  return { start, end };
}

export async function getDashboardData(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  // Financial totals are finance-sensitive: only Owner/Admin and
  // Accountant see them. Other roles still get the operational
  // dashboard, with these three fields as null (the page renders "—"
  // for null instead of a misleading 0).
  const financeGate = await requireRole(db, FINANCE_READ_SENSITIVE);
  const financeAllowed = financeGate.ok;
  try {
    const { start, end } = utcDayRange();
    const [
      summaryRes,
      ledgerRes,
      inwRes,
      batRes,
      passRes,
      latestRes,
      invRes,
      purRes,
      cashRes,
      gdnRes,
    ] = await Promise.all([
      getStockSummary(),
      getStockLedger({ limit: 20 }),
      db
        .from("incoming_goods")
        .select("status, date, total_net_weight_kg, total_bags")
        .eq("status", "posted")
        .gte("date", start)
        .lt("date", end),
      db
        .from("production_batches")
        .select("status, date, actual_output_kg, yield_pct, byproduct_kg")
        .eq("status", "posted")
        .gte("date", start)
        .lt("date", end),
      db
        .from("gate_passes")
        .select("status, date, total_weight_kg, pass_no")
        .eq("status", "posted")
        .gte("date", start)
        .lt("date", end),
      db
        .from("gate_passes")
        .select("pass_no")
        .eq("status", "posted")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      financeAllowed
        ? db.from("customer_invoices").select("balance_amount, total_amount, paid_amount")
        : Promise.resolve({ data: [], error: null }),
      financeAllowed
        ? db.from("purchases").select("balance_amount, total_amount, paid_amount")
        : Promise.resolve({ data: [], error: null }),
      financeAllowed
        ? db.from("cash_accounts").select("opening_balance")
        : Promise.resolve({ data: [], error: null }),
      db
        .from("godowns")
        .select("id, name, capacity_metric_tons")
        .order("code", { ascending: true }),
    ]);

    if (!summaryRes.success) return { success: false, error: summaryRes.error };
    if (!ledgerRes.success) return { success: false, error: ledgerRes.error };
    const queryErrors = [
      inwRes.error,
      batRes.error,
      passRes.error,
      latestRes.error,
      invRes.error,
      purRes.error,
      cashRes.error,
      gdnRes.error,
    ].find(Boolean);
    if (queryErrors) return { success: false, error: queryErrors.message };

    const invoices = (invRes.data ?? []) as {
      balance_amount: number | null;
      total_amount: number | null;
      paid_amount: number | null;
    }[];
    const purchases = (purRes.data ?? []) as typeof invoices;
    return {
      success: true,
      data: {
        summary: summaryRes.data ?? [],
        ledger: ledgerRes.data ?? [],
        godowns: gdnRes.data ?? [],
        inwardToday: inwRes.data ?? [],
        batchesToday: batRes.data ?? [],
        passesToday: passRes.data ?? [],
        latestPassNo: (latestRes.data as { pass_no?: string } | null)?.pass_no ?? null,
        receivables: financeAllowed
          ? invoices.reduce(
            (a, r) => a + num(r.balance_amount ?? num(r.total_amount) - num(r.paid_amount)),
            0,
          )
          : null,
        payables: financeAllowed
          ? purchases.reduce(
            (a, r) => a + num(r.balance_amount ?? num(r.total_amount) - num(r.paid_amount)),
            0,
          )
          : null,
        cashOpening: financeAllowed
          ? ((cashRes.data ?? []) as { opening_balance: number | null }[]).reduce(
            (a, r) => a + num(r.opening_balance),
            0,
          )
          : null,
      },
    };
  } catch (err) {
    return { success: false, error: errMsg(err) };
  }
}
