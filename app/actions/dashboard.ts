"use server";

/**
 * Dashboard aggregates (speed pass).
 *
 * The dashboard's fast fields — today's posted inward / batches /
 * gate passes, the latest posted gate pass, godowns, party
 * receivables/payables and the cash-opening sum — used to fan out to
 * 8 separate queries. They now come from ONE Postgres function,
 * dashboard_today_payload() (supabase/
 * migration-speed-dashboard-payload.sql), with the OLD fan-out kept
 * verbatim as the fallback when the RPC errors (e.g. the migration
 * was never applied live). The fallback produces identical figures;
 * remove it once the migration is confirmed applied live.
 *
 * FIGURE IDENTITY (why the RPC payload equals the old code):
 * - Today rows are returned, NOT pre-summed: the page's reduce math
 *   runs unchanged on identical rows (same status/date predicates,
 *   same UTC-day window, same columns). The old queries had no
 *   ORDER BY and the page only reduces, so row order cannot change
 *   any displayed figure (display formatting rounds to 2dp).
 * - Latest pass: same ORDER BY date DESC, created_at DESC LIMIT 1.
 *   Rows tied on both keys had no specified winner before either.
 * - Godowns: same columns, same ORDER BY code ASC.
 * - Receivables/payables: same type rules and signed-opening
 *   fallback as partyReceivablesPayables() below, over the same
 *   latest-balance pick as party_latest_balances() (DISTINCT ON
 *   created_at DESC, id DESC). All inputs are NUMERIC(15,2), so the
 *   exact decimal sum rounded to 2dp equals the old JS
 *   Math.round(sum * 100) / 100. Tie caveat: the old JS overwrite
 *   picked the maximum created_at with no tiebreak, so identical-
 *   created_at ties had a plan-dependent winner; the SQL id DESC
 *   tiebreak makes that case deterministic instead. Any difference
 *   is confined to that exact-tie case with differing balances.
 * - Cash opening: sum(opening_balance) over ALL cash_accounts (the
 *   old query had no is_active filter), NULL-safe to 0.
 * - The UTC-day window is now built on the DB server (now() AT TIME
 *   ZONE 'UTC') instead of the app server (new Date().toISOString());
 *   the windows agree unless the two clocks disagree across a
 *   UTC-midnight boundary.
 * - Timestamps in the RPC's jsonb rows use the same timestamptz
 *   conversion a direct PostgREST select uses (the RPC runs inside
 *   PostgREST's call), so the page's String(date).slice(0, 10)
 *   sees the same date part. The page consumes only that date part
 *   (plus the numeric columns) from these rows.
 *
 * DELIBERATELY LEFT ON THE OLD PATH (never re-implemented in SQL,
 * because equivalence could not be proven without a live database
 * to test against):
 * - Stock summary: getStockSummary() merges opening_balances rows
 *   of kind "stock" and resolves names in JS.
 * - Recent stock ledger (limit 20, select *): the page reads many
 *   columns; a jsonb re-shape risks dropping one, for one cheap
 *   limited query.
 * - Daybook cash position / per-account balances: getDaybook()
 *   folds master openings, opening_balances evidence, legacy
 *   kind:<kind> groups and inactive-account edge cases into its
 *   closing figure.
 * - Payroll due: getUnpaidSalaries() is one cheap query whose
 *   failure semantics (null, not a page failure) are load-bearing.
 *
 * SECTION ACTIONS (for the streaming server page):
 * - getDashboardFast(): RPC-or-legacy fast fields + payroll due.
 * - getDashboardCash(): daybook cash position (old path verbatim).
 * - getDashboardSlow(): stock summary + recent ledger (old path).
 * Each is independently gated; a section's failure blanks only that
 * section (with its error banner), where the old single aggregate
 * blanked the whole dashboard on any failure. Error message text
 * is unchanged.
 *
 * ROUND TRIPS (data queries; auth gates are cached — see below):
 * - Old getDashboardData: 20 (stock summary 5 incl. openings, ledger
 *   1, today/party/cash/godown queries 8, daybook 5, payroll 1).
 * - New getDashboardData: 13 (RPC 1, summary 5, ledger 1, daybook 5,
 *   payroll 1); legacy fallback still 20.
 * - New streamed page: 13 total, but split so the shell paints with
 *   0 trips, the fast sections after 2 (RPC + payroll), and the
 *   slow sections after the remaining 11 — instead of everything
 *   waiting on all 20 behind one client fetch.
 * - Auth: getCurrentActor() caches the actor for 5 minutes in the
 *   server process, so on a warm server only the first gate of a
 *   request issues getUser + profiles queries; on a cold server
 *   each section action's first gate does, and the rest hit cache.
 *   (The dashboard page's sections share one render request, so
 *   they share the warm cache too.)
 *
 * Financial totals are finance-sensitive: only Owner/Admin and
 * Accountant see them. Other roles still get the operational
 * dashboard, with these fields as null (the page renders "—" for
 * null instead of a misleading 0).
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

// ---------------------------------------------------------------------------
// Fast payload: one RPC, legacy fan-out fallback
// ---------------------------------------------------------------------------

type FastFields = {
  inwardToday: Record<string, unknown>[];
  batchesToday: Record<string, unknown>[];
  passesToday: Record<string, unknown>[];
  latestPassNo: string | null;
  godowns: Record<string, unknown>[];
  receivables: number | null;
  payables: number | null;
  cashOpening: number | null;
};

type FastResult =
  | { success: true; data: FastFields }
  | { success: false; error: string };

async function fetchRpcFast(
  db: Awaited<ReturnType<typeof getDb>>["db"] & object,
  financeAllowed: boolean,
): Promise<FastResult> {
  const rpc = await (db as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc("dashboard_today_payload", { p_include_finance: financeAllowed });
  if (rpc.error || !Array.isArray(rpc.data) || !rpc.data[0]) {
    return { success: false, error: rpc.error?.message ?? "dashboard_today_payload RPC failed." };
  }
  const row = rpc.data[0] as Record<string, unknown>;
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    success: true,
    data: {
      inwardToday: arr(row.inward_today),
      batchesToday: arr(row.batches_today),
      passesToday: arr(row.passes_today),
      latestPassNo: (row.latest_pass_no as string | null) ?? null,
      godowns: arr(row.godowns),
      receivables: financeAllowed ? num(row.receivables) : null,
      payables: financeAllowed ? num(row.payables) : null,
      cashOpening: financeAllowed ? num(row.cash_opening) : null,
    },
  };
}

/**
 * The old fan-out, verbatim (predicates, columns, order, and error
 * precedence unchanged). Used ONLY when the RPC errors, so the
 * dashboard keeps working — with identical figures — until the
 * migration is applied live.
 */
async function legacyFast(
  db: {
    from: (table: string) => any;
    rpc: (name: string) => Promise<{ data: any; error: { message: string } | null }>;
  },
  financeAllowed: boolean,
): Promise<FastResult> {
  const { start, end } = utcDayRange();
  const [
    inwRes,
    batRes,
    passRes,
    latestRes,
    partyRes,
    ledgerBalRes,
    cashRes,
    gdnRes,
  ] = await Promise.all([
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
  ]);
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
  return {
    success: true,
    data: {
      inwardToday: (inwRes.data ?? []) as Record<string, unknown>[],
      batchesToday: (batRes.data ?? []) as Record<string, unknown>[],
      passesToday: (passRes.data ?? []) as Record<string, unknown>[],
      latestPassNo: (latestRes.data as { pass_no?: string } | null)?.pass_no ?? null,
      godowns: (gdnRes.data ?? []) as Record<string, unknown>[],
      receivables: financeAllowed ? receivables : null,
      payables: financeAllowed ? payables : null,
      cashOpening: financeAllowed
        ? ((cashRes.data ?? []) as { opening_balance: number | null }[]).reduce(
          (a, r) => a + num(r.opening_balance),
          0,
        )
        : null,
    },
  };
}

async function rpcOrLegacyFast(
  db: Awaited<ReturnType<typeof getDb>>["db"] & object,
  financeAllowed: boolean,
): Promise<FastResult> {
  const rpc = await fetchRpcFast(db, financeAllowed);
  if (rpc.success) return rpc;
  console.warn(
    "[arco] dashboard_today_payload RPC unavailable, falling back to the legacy fan-out:",
    rpc.error,
  );
  return legacyFast(
    db as unknown as {
      from: (table: string) => any;
      rpc: (name: string) => Promise<{ data: any; error: { message: string } | null }>;
    },
    financeAllowed,
  );
}

// ---------------------------------------------------------------------------
// Section actions (streaming page)
// ---------------------------------------------------------------------------

export async function getDashboardFast(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  const financeGate = await requireRole(db, FINANCE_READ_SENSITIVE);
  const financeAllowed = financeGate.ok;
  try {
    const [fast, unpaidRes] = await Promise.all([
      rpcOrLegacyFast(db, financeAllowed),
      getUnpaidSalaries(),
    ]);
    if (!fast.success) return { success: false, error: fast.error };
    return {
      success: true,
      data: {
        ...fast.data,
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

export async function getDashboardCash(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  const financeGate = await requireRole(db, FINANCE_READ_SENSITIVE);
  const financeAllowed = financeGate.ok;
  if (!financeAllowed) {
    return { success: true, data: { cashPosition: null, cashByAccount: [], cashSource: null } };
  }
  try {
    // LIVE cash position, per account, from the cash ledger: calling
    // getDaybook with from = to = today is enough because its
    // opening already folds in master openings, opening_balances
    // evidence and every prior cash_ledger movement, and its closing
    // is opening + receipts − payments for the day.
    const today = new Date().toISOString().slice(0, 10);
    const daybookRes = await getDaybook({ from: today, to: today });
    // Daybook closing is the live position; if the daybook call fails
    // (e.g. the cash tables are not migrated yet) fall back to the
    // previous opening-balances sum and say so, rather than failing
    // the section. The caller (cash card) renders cashOpening then.
    const daybookData = daybookRes.success ? (daybookRes.data as Record<string, unknown> | undefined) : undefined;
    const cashByAccount = Array.isArray(daybookData?.balances) ? daybookData.balances : [];
    const cashPosition = daybookData && typeof daybookData.closing === "number" ? num(daybookData.closing) : null;
    return {
      success: true,
      data: {
        cashPosition,
        cashByAccount,
        cashSource: cashPosition !== null ? "daybook" : "opening-fallback",
      },
    };
  } catch (err) {
    return { success: false, error: errMsg(err) };
  }
}

export async function getDashboardSlow(): Promise<ActionResult> {
  try {
    const [summaryRes, ledgerRes] = await Promise.all([
      getStockSummary(),
      getStockLedger({ limit: 20 }),
    ]);
    if (!summaryRes.success) return { success: false, error: summaryRes.error };
    if (!ledgerRes.success) return { success: false, error: ledgerRes.error };
    return {
      success: true,
      data: {
        summary: summaryRes.data ?? [],
        ledger: ledgerRes.data ?? [],
      },
    };
  } catch (err) {
    return { success: false, error: errMsg(err) };
  }
}

// ---------------------------------------------------------------------------
// Full aggregate (kept for existing consumers): same shape as before,
// fast fields from the RPC with the legacy fan-out as fallback.
// ---------------------------------------------------------------------------

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
    const today = new Date().toISOString().slice(0, 10);
    const [
      fastRes,
      summaryRes,
      ledgerRes,
      daybookRes,
      unpaidRes,
    ] = await Promise.all([
      rpcOrLegacyFast(db, financeAllowed),
      getStockSummary(),
      getStockLedger({ limit: 20 }),
      // LIVE cash position, per account, from the cash ledger (see
      // getDashboardCash above).
      financeAllowed
        ? getDaybook({ from: today, to: today })
        : Promise.resolve({ success: false, error: "restricted" } as ActionResult),
      // Payroll due is a read-level figure (any signed-in operator),
      // not finance-sensitive, so it is wired regardless of the
      // finance gate above.
      getUnpaidSalaries(),
    ]);

    if (!fastRes.success) return { success: false, error: fastRes.error };
    if (!summaryRes.success) return { success: false, error: summaryRes.error };
    if (!ledgerRes.success) return { success: false, error: ledgerRes.error };

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
        godowns: fastRes.data.godowns,
        inwardToday: fastRes.data.inwardToday,
        batchesToday: fastRes.data.batchesToday,
        passesToday: fastRes.data.passesToday,
        latestPassNo: fastRes.data.latestPassNo,
        receivables: fastRes.data.receivables,
        payables: fastRes.data.payables,
        // Kept for existing consumers: master opening-balances sum.
        cashOpening: fastRes.data.cashOpening,
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
