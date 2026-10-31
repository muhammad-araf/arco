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
// Import only: finance.ts / payroll.ts belong to other teams and are
// never edited here. getDaybook supplies the LIVE cash position and
// getUnpaidSalaries supplies payroll due (see below).
import { getDaybook } from "./finance";
import { getUnpaidSalaries } from "./payroll";
import { errMsg, FINANCE_READ_SENSITIVE } from "./auth-helpers";

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** UTC day window [today 00:00Z, tomorrow 00:00Z). */
function utcDayRange(): { start: string; end: string } {
  const start = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86400000).toISOString();
  return { start, end };
}

/**
 * Receivables / payables from party_ledger balances (STOCK-DASH).
 *
 * party_ledger is the posted-only trail: postInvoice writes +total,
 * postPurchase writes −total, postReceipt writes −amount (the full
 * receipt, so an unapplied advance already nets the party down and can
 * push it negative), and a vendor payment writes +amount (so an
 * unapplied vendor advance nets the payable down). A reversal writes
 * the mirror entry. Draft invoices/purchases never reach this table,
 * so a per-party balance is exactly "posted invoices/purchases, net
 * of unapplied advances" for that party — unlike raw invoice sums,
 * which ignore receipts, payments and advances.
 *
 * Balance per party = latest running_balance, or the signed master
 * opening (payable openings are negative) when the party has no ledger
 * rows yet. Receivables sum the positive balances of customer / both
 * parties; payables sum the absolute negative balances of supplier /
 * both / source parties. A party of unknown type contributes by sign.
 */
function partyReceivablesPayables(
  parties: { id: string; type: string | null; opening_balance: number | null; balance_type: string | null }[],
  ledger: { party_id: string; running_balance: number | null; created_at: string | null }[],
): { receivables: number; payables: number } {
  const latest = new Map<string, number>();
  for (const row of ledger) {
    if (!row.party_id) continue;
    latest.set(row.party_id, num(row.running_balance));
  }
  const byId = new Map(parties.map((p) => [p.id, p]));
  const partyIds = new Set([...parties.map((p) => p.id), ...latest.keys()]);
  let receivables = 0;
  let payables = 0;
  for (const id of partyIds) {
    const party = byId.get(id);
    const balance = latest.has(id)
      ? (latest.get(id) ?? 0)
      : party
        ? (party.balance_type === "payable" ? -num(party.opening_balance) : num(party.opening_balance))
        : 0;
    const type = party?.type ?? null;
    if (type === null) {
      // Ledger party missing from masters: contribute by sign only.
      if (balance > 0) receivables += balance;
      if (balance < 0) payables += -balance;
    } else if (type === "customer") {
      if (balance > 0) receivables += balance;
    } else if (type === "supplier" || type === "source") {
      if (balance < 0) payables += -balance;
    } else if (type === "both") {
      if (balance > 0) receivables += balance;
      if (balance < 0) payables += -balance;
    }
  }
  return { receivables: Math.round(receivables * 100) / 100, payables: Math.round(payables * 100) / 100 };
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
    const today = new Date().toISOString().slice(0, 10);
    const [
      summaryRes,
      ledgerRes,
      inwRes,
      batRes,
      passRes,
      latestRes,
      partyRes,
      ledgerBalRes,
      cashRes,
      gdnRes,
      daybookRes,
      unpaidRes,
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
        .select("status, date, actual_output_kg, yield_pct, byproduct_kg, waste_kg")
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
        ? db.from("parties").select("id, type, opening_balance, balance_type")
        : Promise.resolve({ data: [], error: null }),
      financeAllowed
        ? (async () => {
          // DB-side latest-balance aggregate first (supabase/
          // migration-speed-party-cash-openings.sql): one row per
          // party instead of shipping the whole party_ledger. The
          // RPC's DISTINCT ON (created_at DESC, id DESC) picks the
          // same row the old ascending-order JS overwrite picked:
          // the maximum created_at per party (see the migration's
          // tie caveat for identical-created_at rows, where the old
          // pick was unspecified). INTERIM FALLBACK: if the
          // migration was never applied live, the RPC errors and we
          // fall back to the old full fetch, which produces
          // identical figures — remove the fallback once the
          // migration is confirmed applied.
          const rpc = await db.rpc("party_latest_balances");
          if (!rpc.error && Array.isArray(rpc.data)) {
            return {
              data: (rpc.data as { party_id: string; running_balance: number | null }[]).map((r) => ({
                party_id: r.party_id,
                running_balance: r.running_balance,
                created_at: null,
              })),
              error: null,
            };
          }
          return db
            .from("party_ledger")
            .select("party_id, running_balance, created_at")
            .order("created_at", { ascending: true });
        })()
        : Promise.resolve({ data: [], error: null }),
      financeAllowed
        ? db.from("cash_accounts").select("opening_balance")
        : Promise.resolve({ data: [], error: null }),
      db
        .from("godowns")
        .select("id, name, capacity_metric_tons")
        .order("code", { ascending: true }),
      // LIVE cash position, per account, from the cash ledger: calling
      // getDaybook with from = to = today is enough because its
      // opening already folds in master openings, opening_balances
      // evidence and every prior cash_ledger movement, and its closing
      // is opening + receipts − payments for the day. Fetching all
      // history as entries would add nothing to the closing figure.
      financeAllowed
        ? getDaybook({ from: today, to: today })
        : Promise.resolve({ success: false, error: "restricted" } as ActionResult),
      // Payroll due is a read-level figure (any signed-in operator),
      // not finance-sensitive, so it is wired regardless of the
      // finance gate above.
      getUnpaidSalaries(),
    ]);

    if (!summaryRes.success) return { success: false, error: summaryRes.error };
    if (!ledgerRes.success) return { success: false, error: ledgerRes.error };
    const queryErrors = [
      inwRes.error,
      batRes.error,
      passRes.error,
      latestRes.error,
      partyRes.error,
      ledgerBalRes.error,
      cashRes.error,
      gdnRes.error,
    ].find(Boolean);
    if (queryErrors) return { success: false, error: queryErrors.message };

    const { receivables, payables } = financeAllowed
      ? partyReceivablesPayables(
        (partyRes.data ?? []) as { id: string; type: string | null; opening_balance: number | null; balance_type: string | null }[],
        (ledgerBalRes.data ?? []) as { party_id: string; running_balance: number | null; created_at: string | null }[],
      )
      : { receivables: 0, payables: 0 };
    // Daybook closing is the live position; if the daybook call fails
    // (e.g. the cash tables are not migrated yet) fall back to the
    // previous opening-balances sum and say so, rather than failing
    // the whole dashboard.
    const daybookData = daybookRes.success ? (daybookRes.data as Record<string, unknown> | undefined) : undefined;
    const cashByAccount = Array.isArray(daybookData?.balances) ? daybookData.balances : [];
    const cashPosition = daybookData && typeof daybookData.closing === "number" ? num(daybookData.closing) : null;
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
        receivables: financeAllowed ? receivables : null,
        payables: financeAllowed ? payables : null,
        // Kept for existing consumers: master opening-balances sum.
        cashOpening: financeAllowed
          ? ((cashRes.data ?? []) as { opening_balance: number | null }[]).reduce(
            (a, r) => a + num(r.opening_balance),
            0,
          )
          : null,
        // LIVE cash position: daybook closing (opening + posted
        // receipts − posted payments/expenses, per account in
        // cashByAccount). Null when the daybook call failed; the page
        // then falls back to cashOpening and labels it as opening.
        cashPosition: financeAllowed ? cashPosition : null,
        cashByAccount: financeAllowed ? cashByAccount : [],
        cashSource: financeAllowed ? (cashPosition !== null ? "daybook" : "opening-fallback") : null,
        // Payroll due from getUnpaidSalaries (approved / partially
        // paid periods with a positive balance); null on failure.
        payrollDue: unpaidRes.success
          ? num((unpaidRes.data as { totalUnpaid?: unknown } | undefined)?.totalUnpaid)
          : null,
      },
    };
  } catch (err) {
    return { success: false, error: errMsg(err) };
  }
}
