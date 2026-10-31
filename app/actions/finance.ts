"use server";

/**
 * Finance server actions: purchases, invoices, receipts, vendor payments,
 * expenses, daybook, party statements and P&L (spec §10–§12, §15).
 *
 * Posting rules enforced here (see also SETUP.md):
 * - Draft changes nothing. Posting applies ledger effects EXACTLY ONCE:
 *   create is idempotent on clientToken, and post only runs on a draft
 *   (a repeat post call returns the already-posted row, it never
 *   re-applies effects). Reversals need a mandatory reason and insert
 *   compensating ledger rows; posted rows are never deleted.
 * - Seed/stock purchases move inventory ONLY when goods are received
 *   (receipt_status = 'received'); a bill-only purchase creates the
 *   payable and nothing else. Bardana purchases move packaging inventory.
 * - A receipt is cash collection, NOT revenue: it debits cash and credits
 *   the receivable, with EXPLICIT allocation to invoices or an unapplied
 *   advance. It never blanket-allocates.
 * - Vendor/expense/payroll settlements stay distinct (settlement_kind
 *   on cash rows + payment_allocations.target_type). Paying a vendor
 *   never touches stock again.
 * - P&L revenue = POSTED invoices only (service charges + product sales);
 *   receipts are excluded. COGS is an accountant-supplied approved
 *   valuation, never "all purchases". Packaging cost = consumed-bag
 *   cost only, never purchase + consumption.
 * - Money/ledger arithmetic uses @/lib/calc helpers so the UI, ledger
 *   and payroll can never disagree (sibling backend-core module).
 *
 * Roles: writes are Owner/Admin + Accountant; daybook / party
 * statements / P&L reads are Owner/Admin + Accountant; plain lists are
 * any signed-in operator (they carry no salary/cost/profit detail).
 */

import { revalidatePath } from "next/cache";
import {
  getDb,
  requireRole,
  requireSignedIn,
  type ActionResult,
  type Actor,
  type AppRole,
} from "./auth";
import {
  errMsg,
  FINANCE_WRITE,
  FINANCE_READ_SENSITIVE,
} from "./auth-helpers";
import { logAudit } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/idempotency";
import {
  roundMoney,
  cashRunningBalance,
  daybookClosing,
  ledgerRunningBalance,
} from "@/lib/calc";
import {
  aggregateAllocations,
  exclusiveToBound,
  signedPartyOpening,
} from "@/lib/calc/finance";
import {
  bardanaValuation,
  computeStockValuation,
  isPackagingConsumptionVoucherType,
} from "@/lib/calc/finance-valuation";
import {
  clearMastersCache,
  listGodowns,
  listProducts,
  listParties,
} from "./masters";

type Db = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

// ---------------------------------------------------------------- helpers

function fail<T = never>(error: string): ActionResult<T> {
  return { success: false, error };
}
function ok<T = unknown>(data: T): ActionResult<T> {
  return { success: true, data };
}

/**
 * Server-side sequential document number via the next_doc_number RPC
 * (same pattern as the stock actions). Falls back to a timestamp
 * suffix only when the numbering table/RPC is not yet migrated, so a
 * missing migration can never block posting — it only re-opens the
 * same-millisecond collision window the old genNo had.
 */
async function nextDocNo(db: Db, series: string, prefix: string): Promise<string> {
  const rpc = await db.rpc("next_doc_number", { p_series: series, p_prefix: prefix });
  if (!rpc.error && typeof rpc.data === "string" && rpc.data) return rpc.data;
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${prefix}-${ymd}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * Cash account a cash movement must land in. Every receipt, vendor
 * payment and paid expense now carries a selected account: a NULL
 * cash_account_id row is invisible in per-account daybook views, so
 * creation fails closed instead of writing one. The account's kind
 * must match the movement's kind (a bank account cannot receive a
 * "cash" movement) — the UI filters selectors by kind.
 */
async function validateCashAccount(
  db: Db,
  cashAccountId: string | null | undefined,
  kind: string,
): Promise<{ ok: true; account: Record<string, unknown> } | { ok: false; error: string }> {
  if (!cashAccountId) {
    return { ok: false, error: "Select a cash account for this payment. Create one on the Daybook page first if none exists." };
  }
  const { data: acct } = await db.from("cash_accounts").select("*").eq("id", cashAccountId).maybeSingle();
  if (!acct) return { ok: false, error: "The selected cash account does not exist." };
  if ((acct as Record<string, unknown>).is_active === false) {
    return { ok: false, error: "The selected cash account is inactive; reactivate it on the Masters page first." };
  }
  if ((acct as Record<string, unknown>).account_kind !== kind) {
    return { ok: false, error: `The selected cash account is a ${(acct as Record<string, unknown>).account_kind} account, not a ${kind} account.` };
  }
  return { ok: true, account: acct as Record<string, unknown> };
}

/**
 * Sum of opening_balances evidence rows for one party (kind 'party',
 * as_of on or before the statement's `to` date). createOpeningBalance
 * writes ONLY the evidence row — it never touches parties.opening_
 * balance — so these rows are additional opening, not a second copy
 * of the master field. If an operator ever sets BOTH the master field
 * and an evidence row for the same amount, the two WILL double-count:
 * the statement return value breaks the two apart (masterOpening vs
 * evidenceOpening) so that is visible instead of hidden. Rows dated
 * after `to` are excluded; rows dated inside the period are folded
 * into opening so the closing balance stays correct.
 */
async function partyEvidenceOpening(
  db: Db,
  partyId: string,
  to: string,
  balanceType: string | null | undefined,
): Promise<{ total: number; raw: number }> {
  const toDate = to.slice(0, 10);
  const { data } = await db.from("opening_balances").select("amount, as_of")
    .eq("balance_kind", "party").eq("party_id", partyId);
  let raw = 0;
  for (const r of data ?? []) {
    if (String((r as Record<string, unknown>).as_of ?? "").slice(0, 10) <= toDate) {
      raw = roundMoney(raw + (Number((r as Record<string, unknown>).amount) || 0));
    }
  }
  return { total: signedPartyOpening(raw, balanceType), raw };
}

function pos(value: unknown, name: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return roundMoney(n);
}

function nonNeg(value: unknown, name: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}

async function byToken(
  db: Db,
  table: string,
  token: string | undefined | null,
): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const { data } = await db.from(table).select("*").eq("client_token", token).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * After a guarded status flip fails: if the row is already in the
 * target status, a concurrent writer completed the transition and
 * this call replays successfully. The ledger rows are unique by
 * (voucher, line), so the union of both writers' rows is exactly one
 * copy of each line -- replaying is correct, failing is not.
 */
async function replayIfFlipped(
  db: Db,
  table: string,
  id: string,
  targetStatus: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (data && (data as Record<string, unknown>).status === targetStatus) {
    return data as Record<string, unknown>;
  }
  return null;
}

async function lastRow(
  db: Db,
  table: string,
  filters: [string, unknown][],
): Promise<Record<string, unknown> | null> {
  let q = db.from(table).select("*").order("created_at", { ascending: false }).limit(1);
  for (const [col, val] of filters) q = q.eq(col, val);
  const { data } = await q.maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * Party ledger entry. Delta is RECEIVABLE-POSITIVE: invoice/purchase
 * effects use +/− per the table in SETUP.md. Running balance is derived
 * from the previous row (or the party's signed opening balance).
 */
async function partyEntry(
  db: Db,
  input: {
    partyId: string;
    date: string;
    entryType: string;
    voucherType: string;
    voucherId: string;
    voucherNo: string;
    delta: number;
    notes?: string;
    userId?: string | null;
    /** Index of this row within its voucher's rows of this entry type. */
    lineNo?: number;
  },
): Promise<void> {
  const prev = await lastRow(db, "party_ledger", [["party_id", input.partyId]]);
  let opening = 0;
  if (!prev) {
    const { data: party } = await db
      .from("parties")
      .select("opening_balance, balance_type")
      .eq("id", input.partyId)
      .maybeSingle();
    if (party) {
      opening = party.balance_type === "payable"
        ? -roundMoney(Number(party.opening_balance) || 0)
        : roundMoney(Number(party.opening_balance) || 0);
    }
  }
  const prevBal = prev ? Number(prev.running_balance) || 0 : opening;
  const running = roundMoney(prevBal + roundMoney(input.delta));
  const { error } = await db.from("party_ledger").insert({
    date: input.date,
    party_id: input.partyId,
    entry_type: input.entryType,
    voucher_type: input.voucherType,
    voucher_id: input.voucherId,
    voucher_no: input.voucherNo,
    debit: input.delta > 0 ? roundMoney(input.delta) : 0,
    credit: input.delta < 0 ? roundMoney(-input.delta) : 0,
    running_balance: running,
    notes: input.notes ?? null,
    created_by: input.userId ?? null,
    line_no: input.lineNo ?? 0,
  });
  if (error && isUniqueViolation(error)) return;
  if (error) throw new Error(`party_ledger insert failed: ${error.message}`);
}

/** Cash ledger entry with a running balance scoped to its account. */
async function cashEntry(
  db: Db,
  input: {
    date: string;
    voucherType: string;
    voucherId: string;
    voucherNo: string;
    account: string;
    cashAccountId?: string | null;
    debit: number;
    credit: number;
    description: string;
    settlementKind?: string;
    userId?: string | null;
    /** Index of this row within its voucher's cash rows. */
    lineNo?: number;
  },
): Promise<void> {
  const filters: [string, unknown][] = input.cashAccountId
    ? [["cash_account_id", input.cashAccountId]]
    : [["account", input.account]];
  const prev = await lastRow(db, "cash_ledger", filters);
  const running = cashRunningBalance(
    prev ? Number(prev.running_balance) || 0 : 0,
    input.debit,
    input.credit,
  );
  const { error } = await db.from("cash_ledger").insert({
    date: input.date,
    voucher_type: input.voucherType,
    voucher_id: input.voucherId,
    voucher_no: input.voucherNo,
    account: input.account,
    cash_account_id: input.cashAccountId ?? null,
    debit: roundMoney(input.debit),
    credit: roundMoney(input.credit),
    running_balance: running,
    description: input.description,
    settlement_kind: input.settlementKind ?? null,
    line_no: input.lineNo ?? 0,
    created_by: input.userId ?? null,
  });
  if (error && isUniqueViolation(error)) return;
  if (error) throw new Error(`cash_ledger insert failed: ${error.message}`);
}

/** Stock ledger inward/outward row (seed purchases only, when received). */
async function stockEntry(
  db: Db,
  input: {
    date: string;
    voucherType: string;
    voucherId: string;
    voucherNo: string;
    godownId: string;
    productId: string;
    partyId?: string | null;
    inwardQty: number;
    outwardQty: number;
    notes?: string;
    userId?: string | null;
    /** Index of this row within its voucher's stock rows. */
    lineNo?: number;
  },
): Promise<void> {
  const prev = await lastRow(db, "stock_ledger", [
    ["godown_id", input.godownId],
    ["product_id", input.productId],
  ]);
  const running = ledgerRunningBalance(
    prev ? Number(prev.running_balance) || 0 : 0,
    input.inwardQty,
    input.outwardQty,
  );
  const { error } = await db.from("stock_ledger").insert({
    date: input.date,
    voucher_type: input.voucherType,
    voucher_id: input.voucherId,
    voucher_no: input.voucherNo,
    godown_id: input.godownId,
    product_id: input.productId,
    party_id: input.partyId ?? null,
    inward_qty: input.inwardQty,
    outward_qty: input.outwardQty,
    unit: "kg",
    running_balance: running,
    notes: input.notes ?? null,
    created_by: input.userId ?? null,
    line_no: input.lineNo ?? 0,
  });
  if (error && isUniqueViolation(error)) return;
  if (error) throw new Error(`stock_ledger insert failed: ${error.message}`);
}

/** Bardana ledger row; quantities are BAG counts (see bagClosing). */
async function bardanaEntry(
  db: Db,
  input: {
    date: string;
    voucherType: string;
    voucherId: string;
    voucherNo: string;
    packagingTypeId: string;
    godownId?: string | null;
    inQty: number;
    outQty: number;
    unitCost?: number | null;
    notes?: string;
    userId?: string | null;
    /** Index of this row within its voucher's bardana rows. */
    lineNo?: number;
  },
): Promise<void> {
  const prev = await lastRow(db, "bardana_ledger", [
    ["packaging_type_id", input.packagingTypeId],
  ]);
  const running = (prev ? Number(prev.running_balance) || 0 : 0) + input.inQty - input.outQty;
  const totalCost = input.unitCost != null
    ? roundMoney((input.inQty || input.outQty) * input.unitCost)
    : null;
  const { error } = await db.from("bardana_ledger").insert({
    date: input.date,
    packaging_type_id: input.packagingTypeId,
    godown_id: input.godownId ?? null,
    voucher_type: input.voucherType,
    voucher_id: input.voucherId,
    voucher_no: input.voucherNo,
    in_qty: input.inQty,
    out_qty: input.outQty,
    unit_cost: input.unitCost ?? null,
    total_cost: totalCost,
    running_balance: running,
    notes: input.notes ?? null,
    created_by: input.userId ?? null,
    line_no: input.lineNo ?? 0,
  });
  if (error && isUniqueViolation(error)) return;
  if (error) throw new Error(`bardana_ledger insert failed: ${error.message}`);
}

async function requireWrite(
  db: Db,
): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireRole(db, FINANCE_WRITE);
  if (!gate.ok) return { error: gate.error };
  return { actor: gate.actor };
}

async function requireSensitiveRead(
  db: Db,
): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireRole(db, FINANCE_READ_SENSITIVE);
  if (!gate.ok) return { error: gate.error };
  return { actor: gate.actor };
}

/**
 * Exclusive next-day bound for a plain YYYY-MM-DD `to` value, computed
 * HERE (not imported) so this file's list bounds never depend on
 * another module's helper: date columns are TIMESTAMPTZ, so a plain
 * `.lte("date", "2026-10-27")` means midnight at the START of the 27th
 * and silently drops the whole day. A full timestamp is returned
 * unchanged and keeps its exact `.lte` bound.
 */
function exclusiveNextDay(to: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const d = new Date(`${to}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) {
      return new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
    }
  }
  return to;
}

/** True only for a plain YYYY-MM-DD date (the case needing a next-day bound). */
function isPlainDate(to: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(to);
}

function dateRange(q: {
  from?: string;
  to?: string;
  column?: string;
}, builder: {
  gte: (col: string, v: string) => typeof builder;
  lt: (col: string, v: string) => typeof builder;
  lte: (col: string, v: string) => typeof builder;
}): typeof builder {
  const col = q.column ?? "date";
  let b = builder;
  if (q.from) b = b.gte(col, q.from);
  if (q.to) {
    // The `to` day is inclusive: a plain date becomes `< next day`.
    b = isPlainDate(q.to) ? b.lt(col, exclusiveNextDay(q.to)) : b.lte(col, q.to);
  }
  return b;
}

/**
 * Paged-list window, same shape as the stock ledger register:
 * page is 1-based, pageSize defaults to 50 and clamps to 1–200.
 * Lists return the paged shape { rows, total, page, pageSize } only
 * when the caller passes `page`; without it they keep returning the
 * legacy plain array so existing callers are untouched.
 */
function pageWindow(filters: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
  fromRow: number;
  toRow: number;
} {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);
  return { page, pageSize, fromRow: (page - 1) * pageSize, toRow: page * pageSize - 1 };
}

// ------------------------------------------------- finance reference-data cache
// Cash accounts and expense categories are reference data owned by
// this file: every write to either table goes through the functions
// below, so each list can be cached with the same shape as masters.ts
// (module entry, 5-minute TTL, in-flight dedup, signed-in gate before
// the cache lookup). The generation counter closes the
// clear-during-fetch race: a fetch that started before a write never
// repopulates the cache with pre-write rows. The TTL is only a
// backstop for out-of-band edits; every successful write below clears
// its cache entry (cash-account writes also clear the masters cache,
// which serves cash_accounts via getCommonMasters). Nothing here
// caches ledger rows, balances, or computed figures: the cash-ledger
// opening-balance query further down stays uncached on purpose.
const FINANCE_REFERENCE_TTL_MS = 300000;
let cachedCashAccounts: { data: unknown; expires: number } | null = null;
let cashAccountsPending: Promise<ActionResult> | null = null;
let cashAccountsGeneration = 0;
let cachedExpenseCategories: { data: unknown; expires: number } | null = null;
let expenseCategoriesPending: Promise<ActionResult> | null = null;
let expenseCategoriesGeneration = 0;

function clearCashAccountsCache(): void {
  cashAccountsGeneration += 1;
  cachedCashAccounts = null;
  cashAccountsPending = null;
}
function clearExpenseCategoriesCache(): void {
  expenseCategoriesGeneration += 1;
  cachedExpenseCategories = null;
  expenseCategoriesPending = null;
}

// ---------------------------------------------------------------- cash accounts

export async function listCashAccounts(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  if (cachedCashAccounts && Date.now() < cachedCashAccounts.expires) {
    const data = cachedCashAccounts.data;
    return { success: true, data: Array.isArray(data) ? [...data] : data };
  }
  if (cashAccountsPending) return cashAccountsPending;
  const generation = cashAccountsGeneration;
  let fetchPromise: Promise<ActionResult> | null = null;
  fetchPromise = (async () => {
    try {
      const { data, error: qError } = await db
        .from("cash_accounts")
        .select("*")
        .order("code", { ascending: true });
      if (qError) return fail(qError.message);
      if (generation === cashAccountsGeneration) {
        cachedCashAccounts = {
          data,
          expires: Date.now() + FINANCE_REFERENCE_TTL_MS,
        };
      }
      return { success: true, data };
    } finally {
      if (cashAccountsPending === fetchPromise) cashAccountsPending = null;
    }
  })();
  cashAccountsPending = fetchPromise;
  return fetchPromise;
}

export async function createCashAccount(input: {
  code: string;
  name: string;
  accountKind: "cash" | "bank" | "online";
  openingBalance?: number;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!input.code?.trim() || !input.name?.trim()) {
    return fail("Cash account code and name are required.");
  }
  const opening = nonNeg(input.openingBalance ?? 0, "openingBalance");
  if (opening === null) return fail("openingBalance must be >= 0.");
  const { data, error: iError } = await db
    .from("cash_accounts")
    .insert({
      code: input.code.trim(),
      name: input.name.trim(),
      account_kind: input.accountKind,
      opening_balance: opening,
    })
    .select()
    .single();
  if (iError) return fail(iError.message);
  clearCashAccountsCache();
  await clearMastersCache();
  await logAudit(db, {
    action: "create", entityType: "cash_accounts", entityId: data.id,
    after: { code: input.code, opening_balance: opening },
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/daybook");
  revalidatePath("/ledgers");
  return { success: true, data };
}

/**
 * Edit a cash account. Code and kind are immutable after creation (the
 * kind decides which movements may land in the account, and existing
 * ledger rows already carry it); only the display name and the opening
 * balance change. Rows are never deleted: use deactivate/reactivate.
 */
export async function updateCashAccount(input: {
  id: string;
  name?: string;
  openingBalance?: number;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!input.id) return fail("id is required.");
  if (input.name !== undefined && !input.name.trim()) {
    return fail("Cash account name is required.");
  }
  if (input.openingBalance !== undefined && nonNeg(input.openingBalance, "openingBalance") === null) {
    return fail("openingBalance must be >= 0.");
  }
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.openingBalance !== undefined) patch.opening_balance = input.openingBalance;
  if (Object.keys(patch).length === 0) return fail("Nothing to update.");
  const { data: before } = await db.from("cash_accounts").select("*").eq("id", input.id).maybeSingle();
  if (!before) return fail("Cash account not found.");
  const { data, error: uError } = await db
    .from("cash_accounts")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  clearCashAccountsCache();
  await clearMastersCache();
  await logAudit(db, {
    action: "update", entityType: "cash_accounts", entityId: input.id,
    before: before as Record<string, unknown>, after: patch,
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/daybook");
  revalidatePath("/ledgers");
  return { success: true, data };
}

async function setCashAccountActive(id: string, active: boolean): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!id) return fail("id is required.");
  const { data, error: uError } = await db
    .from("cash_accounts")
    .update({ is_active: active })
    .eq("id", id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  clearCashAccountsCache();
  await clearMastersCache();
  await logAudit(db, {
    action: active ? "reactivate" : "deactivate", entityType: "cash_accounts", entityId: id,
    before: { is_active: !active }, after: { is_active: active },
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/daybook");
  revalidatePath("/ledgers");
  return { success: true, data };
}

export async function deactivateCashAccount(id: string): Promise<ActionResult> {
  return setCashAccountActive(id, false);
}

export async function reactivateCashAccount(id: string): Promise<ActionResult> {
  return setCashAccountActive(id, true);
}

// ---------------------------------------------------------------- purchases

export interface PurchaseItemInput {
  itemType: "seed" | "packaging";
  productId?: string | null;
  packagingTypeId?: string | null;
  quantity: number;
  bagsCount?: number;
  unit?: string;
  unitPrice: number;
}

export interface PurchaseInput {
  vendorId: string;
  date?: string;
  invoiceRef?: string;
  godownId?: string | null;
  receiptStatus?: "received" | "bill_only";
  discountAmount?: number;
  taxAmount?: number;
  notes?: string;
  clientToken?: string;
  items: PurchaseItemInput[];
}

export async function listPurchases(filters: {
  vendorId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  if (filters.page !== undefined) {
    const { page, pageSize, fromRow, toRow } = pageWindow(filters);
    let pq = db.from("purchases").select("*, purchase_items(*)", { count: "exact" }).order("date", { ascending: false });
    if (filters.vendorId) pq = pq.eq("vendor_id", filters.vendorId);
    if (filters.status) pq = pq.eq("status", filters.status);
    pq = dateRange(filters, pq as never) as typeof pq;
    const { data, error: qError, count } = await pq.range(fromRow, toRow);
    if (qError) return fail(qError.message);
    return { success: true, data: { rows: data, total: count ?? (data ?? []).length, page, pageSize } };
  }
  let q = db.from("purchases").select("*, purchase_items(*)").order("date", { ascending: false });
  if (filters.vendorId) q = q.eq("vendor_id", filters.vendorId);
  if (filters.status) q = q.eq("status", filters.status);
  q = dateRange(filters, q as never) as typeof q;
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}

export async function createPurchase(input: PurchaseInput): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (input.clientToken) {
      const existing = await byToken(db, "purchases", input.clientToken);
      if (existing) return { success: true, data: existing };
    }
    if (!input.vendorId) return fail("vendorId is required.");
    if (!input.items?.length) return fail("At least one purchase line is required.");
    const lines = [];
    let subtotal = 0;
    for (const item of input.items) {
      const qty = nonNeg(item.quantity, "quantity");
      const price = nonNeg(item.unitPrice, "unitPrice");
      if (qty === null || price === null) return fail("Quantities and unit prices must be >= 0.");
      if (item.itemType === "seed" && !item.productId) return fail("Seed lines need a productId.");
      if (item.itemType === "packaging" && !item.packagingTypeId) {
        return fail("Packaging lines need a packagingTypeId.");
      }
      const lineTotal = roundMoney(qty * price);
      subtotal = roundMoney(subtotal + lineTotal);
      lines.push({
        product_id: item.itemType === "seed" ? item.productId : null,
        packaging_type_id: item.itemType === "packaging" ? item.packagingTypeId : null,
        item_type: item.itemType,
        quantity: qty,
        bags_count: item.bagsCount ?? 0,
        unit: item.unit ?? "kg",
        unit_price: price,
        line_total: lineTotal,
      });
    }
    const discount = nonNeg(input.discountAmount ?? 0, "discount");
    const tax = nonNeg(input.taxAmount ?? 0, "tax");
    if (discount === null || tax === null) return fail("Discount/tax must be >= 0.");
    const total = roundMoney(subtotal - discount + tax);
    const { data, error: iError } = await db
      .from("purchases")
      .insert({
        purchase_no: await nextDocNo(db, "purchase", "PUR"),
        date: input.date ?? new Date().toISOString(),
        vendor_id: input.vendorId,
        invoice_ref: input.invoiceRef ?? null,
        godown_id: input.godownId ?? null,
        receipt_status: input.receiptStatus ?? "received",
        status: "draft",
        discount_amount: discount,
        tax_amount: tax,
        total_amount: total,
        paid_amount: 0,
        balance_amount: total,
        client_token: input.clientToken ?? null,
        notes: input.notes ?? null,
        created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError) return fail(iError.message);
    const { error: lError } = await db
      .from("purchase_items")
      .insert(lines.map((l) => ({ ...l, purchase_id: data.id })));
    if (lError) return fail(lError.message);
    await logAudit(db, {
      action: "create", entityType: "purchases", entityId: data.id,
      voucherNo: data.purchase_no, after: { total_amount: total, status: "draft" },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    revalidatePath("/purchases");
    return { success: true, data };
  } catch (err) {
    return fail(errMsg(err));
  }
}

/**
 * Post a draft purchase. Seed lines move stock and bardana lines move
 * packaging ONLY when receipt_status = 'received'; a bill-only purchase
 * creates the payable and nothing else. Idempotent: re-posting an
 * already-posted purchase returns it unchanged.
 */
export async function postPurchase(
  id: string,
  opts: { reason?: string } = {},
): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    const { data: purchase } = await db.from("purchases").select("*").eq("id", id).single();
    if (!purchase) return fail("Purchase not found.");
    if (purchase.status === "posted") return { success: true, data: purchase };
    if (purchase.status !== "draft") {
      return fail(`Only a draft purchase can be posted (status: ${purchase.status}).`);
    }
    const { data: items } = await db.from("purchase_items").select("*").eq("purchase_id", id);
    if (purchase.receipt_status === "received") {
      for (let itemIdx = 0; itemIdx < (items ?? []).length; itemIdx++) {
        const item = (items ?? [])[itemIdx];
        if (item.item_type === "seed") {
          if (!purchase.godown_id) return fail("A godown is required to receive seed stock.");
          await stockEntry(db, {
            date: purchase.date, voucherType: "purchase", voucherId: purchase.id,
            voucherNo: purchase.purchase_no, godownId: purchase.godown_id,
            productId: item.product_id, partyId: purchase.vendor_id,
            inwardQty: Number(item.quantity) || 0, outwardQty: 0,
            notes: "Purchase receipt", userId: gate.actor.userId, lineNo: itemIdx,
          });
        } else {
          const bags = Number(item.bags_count) || Math.round(Number(item.quantity) || 0);
          await bardanaEntry(db, {
            date: purchase.date, voucherType: "purchase", voucherId: purchase.id,
            voucherNo: purchase.purchase_no, packagingTypeId: item.packaging_type_id,
            godownId: purchase.godown_id, inQty: bags, outQty: 0,
            unitCost: Number(item.unit_price) || null,
            notes: "Bardana purchase", userId: gate.actor.userId, lineNo: itemIdx,
          });
        }
      }
    }
    await partyEntry(db, {
      partyId: purchase.vendor_id, date: purchase.date, entryType: "purchase",
      voucherType: "purchase", voucherId: purchase.id, voucherNo: purchase.purchase_no,
      delta: -roundMoney(Number(purchase.total_amount) || 0),
      notes: "Vendor payable on posted purchase", userId: gate.actor.userId,
    });
    const { data: updated, error: uError } = await db
      .from("purchases")
      .update({ status: "posted", posted_at: new Date().toISOString(), updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "purchases", id, "posted");
      if (replayed) return { success: true, data: replayed };
      return fail("Purchase could not be posted (it may have been posted concurrently).");
    }
    await logAudit(db, {
      action: "post", entityType: "purchases", entityId: id,
      voucherNo: purchase.purchase_no,
      before: { status: "draft" }, after: { status: "posted", total_amount: purchase.total_amount },
      reason: opts.reason ?? null, userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    revalidatePath("/purchases");
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function reversePurchase(id: string, reason: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!reason?.trim()) return fail("A reason is mandatory to reverse a posted purchase.");
  try {
    const { data: purchase } = await db.from("purchases").select("*").eq("id", id).single();
    if (!purchase) return fail("Purchase not found.");
    if (purchase.status !== "posted") return fail("Only a posted purchase can be reversed.");
    if (Number(purchase.paid_amount) > 0) {
      return fail("Purchase has payments allocated; reverse the payments first, then reverse the purchase.");
    }
    // Posted returns already took stock out and credited the vendor
    // for part of this purchase. Reversing the whole purchase as well
    // would double-apply every return (double stock-out, double
    // credit), so reversal is blocked while a posted return exists.
    // There is no return-reversal action yet: a blocked purchase stays
    // blocked until one is added (see final report / coordinator note).
    const { data: postedReturns } = await db.from("purchase_returns").select("id")
      .eq("purchase_id", id).eq("status", "posted").limit(1);
    if ((postedReturns ?? []).length > 0) {
      return fail("Purchase has posted returns; reversing it would double-apply those returns. Reverse the returns first (no return-reversal action exists yet), then reverse the purchase.");
    }
    const { data: items } = await db.from("purchase_items").select("*").eq("purchase_id", id);
    if (purchase.receipt_status === "received") {
      for (let itemIdx = 0; itemIdx < (items ?? []).length; itemIdx++) {
        const item = (items ?? [])[itemIdx];
        if (item.item_type === "seed" && purchase.godown_id) {
          await stockEntry(db, {
            date: new Date().toISOString(), voucherType: "purchase_reversal",
            voucherId: purchase.id, voucherNo: `${purchase.purchase_no}-R`,
            godownId: purchase.godown_id, productId: item.product_id,
            partyId: purchase.vendor_id, inwardQty: 0,
            outwardQty: Number(item.quantity) || 0,
            notes: `Reversal: ${reason}`, userId: gate.actor.userId, lineNo: itemIdx,
          });
        } else if (item.item_type === "packaging") {
          const bags = Number(item.bags_count) || Math.round(Number(item.quantity) || 0);
          await bardanaEntry(db, {
            date: new Date().toISOString(), voucherType: "purchase_reversal",
            voucherId: purchase.id, voucherNo: `${purchase.purchase_no}-R`,
            packagingTypeId: item.packaging_type_id, godownId: purchase.godown_id,
            inQty: 0, outQty: bags, notes: `Reversal: ${reason}`, userId: gate.actor.userId, lineNo: itemIdx,
          });
        }
      }
    }
    await partyEntry(db, {
      partyId: purchase.vendor_id, date: new Date().toISOString(), entryType: "reversal",
      voucherType: "purchase", voucherId: purchase.id, voucherNo: `${purchase.purchase_no}-R`,
      delta: roundMoney(Number(purchase.total_amount) || 0),
      notes: `Purchase reversal: ${reason}`, userId: gate.actor.userId,
    });
    const { data: updated, error: uError } = await db
      .from("purchases")
      .update({ status: "reversed", reversal_reason: reason, balance_amount: 0, updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "purchases", id, "reversed");
      if (replayed) return { success: true, data: replayed };
      return fail("Purchase could not be reversed (concurrent change?).");
    }
    await logAudit(db, {
      action: "reverse", entityType: "purchases", entityId: id,
      voucherNo: purchase.purchase_no, before: { status: "posted" },
      after: { status: "reversed" }, reason,
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    revalidatePath("/purchases");
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ------------------------------------------------------- purchase returns

export async function listPurchaseReturns(purchaseId?: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  let q = db.from("purchase_returns").select("*, purchase_return_items(*)").order("date", { ascending: false });
  if (purchaseId) q = q.eq("purchase_id", purchaseId);
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}

/**
 * Purchase-return guards, shared by create and post so a draft written
 * before a guard existed (or raced with another return) cannot post
 * past it:
 * - line ownership: every return line must name a line of THIS purchase;
 *   a line from another purchase (or a missing line) fails, never skips.
 * - cumulative quantity: returns already recorded against a line
 *   (draft + posted, excluding reversed) plus this return must not
 *   exceed the line's purchased quantity — otherwise stock goes
 *   negative and the vendor is over-credited.
 * - price: a return price above the line's purchase price over-credits
 *   the vendor, so it fails. Quantity must be > 0 (a 0-qty line is a
 *   no-op return, not a return).
 * `excludeReturnId` is the return being posted, so its own lines are
 * not counted twice in the cumulative check.
 */
async function validateReturnLines(
  db: Db,
  purchase: Record<string, unknown>,
  items: { purchaseItemId: string; quantity: number; unitPrice: number }[],
  excludeReturnId?: string,
): Promise<{ ok: true; lines: { purchase_item_id: string; quantity: number; unit_price: number; line_total: number }[] } | { ok: false; error: string }> {
  const { data: origItems } = await db.from("purchase_items").select("*").eq("purchase_id", purchase.id);
  const origById = new Map<string, Record<string, unknown>>();
  for (const o of origItems ?? []) origById.set(String((o as Record<string, unknown>).id), o as Record<string, unknown>);
  // Aggregate duplicate lines for the same purchase item within one request.
  const byItem = new Map<string, { quantity: number; unitPrice: number }>();
  for (const item of items) {
    const qty = pos(item.quantity, "quantity");
    if (qty === null) return { ok: false, error: "Return quantities must be > 0." };
    const price = nonNeg(item.unitPrice, "unitPrice");
    if (price === null) return { ok: false, error: "Return prices must be >= 0." };
    const orig = origById.get(item.purchaseItemId);
    if (!orig) return { ok: false, error: `Return line ${item.purchaseItemId} does not belong to purchase ${purchase.purchase_no}.` };
    if (price > (Number(orig.unit_price) || 0)) {
      return { ok: false, error: `Return price ${price} exceeds the purchase price ${orig.unit_price} for that line; a return cannot credit more than was paid.` };
    }
    const cur = byItem.get(item.purchaseItemId);
    if (cur) {
      if (price !== cur.unitPrice) return { ok: false, error: "Duplicate return lines for one purchase line must carry the same price." };
      cur.quantity = roundMoney(cur.quantity + qty);
    } else byItem.set(item.purchaseItemId, { quantity: qty, unitPrice: price });
  }
  // Cumulative quantity already returned against each line.
  const { data: priorReturns } = await db.from("purchase_returns").select("id")
    .eq("purchase_id", purchase.id).neq("status", "reversed");
  const priorIds = (priorReturns ?? [])
    .map((r) => String((r as Record<string, unknown>).id))
    .filter((id) => id !== excludeReturnId);
  const returnedQty = new Map<string, number>();
  if (priorIds.length) {
    const { data: priorLines } = await db.from("purchase_return_items").select("*").in("return_id", priorIds);
    for (const l of priorLines ?? []) {
      const k = String((l as Record<string, unknown>).purchase_item_id);
      returnedQty.set(k, roundMoney((returnedQty.get(k) ?? 0) + (Number((l as Record<string, unknown>).quantity) || 0)));
    }
  }
  const lines = [];
  for (const [purchaseItemId, v] of byItem) {
    const orig = origById.get(purchaseItemId)!;
    const already = returnedQty.get(purchaseItemId) ?? 0;
    if (roundMoney(already + v.quantity) > (Number(orig.quantity) || 0)) {
      return { ok: false, error: `Return quantity ${v.quantity} for a line already returned ${already} exceeds its purchased quantity ${orig.quantity}.` };
    }
    lines.push({ purchase_item_id: purchaseItemId, quantity: v.quantity, unit_price: v.unitPrice, line_total: roundMoney(v.quantity * v.unitPrice) });
  }
  return { ok: true, lines };
}

export async function createPurchaseReturn(input: {
  purchaseId: string;
  reason: string;
  date?: string;
  clientToken?: string;
  items: { purchaseItemId: string; quantity: number; unitPrice: number }[];
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (input.clientToken) {
      const existing = await byToken(db, "purchase_returns", input.clientToken);
      if (existing) return { success: true, data: existing };
    }
    if (!input.reason?.trim()) return fail("A reason is required for a purchase return.");
    if (!input.items?.length) return fail("At least one return line is required.");
    const { data: purchase } = await db.from("purchases").select("*").eq("id", input.purchaseId).single();
    if (!purchase || purchase.status !== "posted") {
      return fail("Returns link to a posted original purchase (a draft or reversed purchase cannot be returned).");
    }
    const checked = await validateReturnLines(db, purchase, input.items);
    if (!checked.ok) return fail(checked.error);
    const lines = checked.lines;
    const total = lines.reduce((s, l) => roundMoney(s + l.line_total), 0);
    const { data, error: iError } = await db
      .from("purchase_returns")
      .insert({
        return_no: await nextDocNo(db, "purchase_return", "PRT"), purchase_id: input.purchaseId,
        date: input.date ?? new Date().toISOString(), reason: input.reason,
        total_amount: total, status: "draft",
        client_token: input.clientToken ?? null, created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError) return fail(iError.message);
    const { error: lError } = await db
      .from("purchase_return_items")
      .insert(lines.map((l) => ({ ...l, return_id: data.id })));
    if (lError) return fail(lError.message);
    return { success: true, data };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function postPurchaseReturn(id: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    const { data: ret } = await db.from("purchase_returns").select("*").eq("id", id).single();
    if (!ret) return fail("Purchase return not found.");
    if (ret.status === "posted") return { success: true, data: ret };
    if (ret.status !== "draft") return fail("Only a draft return can be posted.");
    const { data: purchase } = await db.from("purchases").select("*").eq("id", ret.purchase_id).single();
    if (!purchase) return fail("Original purchase not found.");
    // Re-check the guards at post time: a draft created earlier (or a
    // concurrent return) must not post past them, and a purchase
    // reversed after the draft was created cannot take a return.
    if (purchase.status !== "posted") {
      return fail("The original purchase is no longer posted, so this return cannot be posted.");
    }
    const { data: lines } = await db.from("purchase_return_items").select("*").eq("return_id", id);
    const rechecked = await validateReturnLines(
      db, purchase,
      (lines ?? []).map((l) => ({ purchaseItemId: l.purchase_item_id, quantity: Number(l.quantity) || 0, unitPrice: Number(l.unit_price) || 0 })),
      id,
    );
    if (!rechecked.ok) return fail(rechecked.error);
    if (purchase.receipt_status === "received") {
      for (let lineIdx = 0; lineIdx < (lines ?? []).length; lineIdx++) {
        const line = (lines ?? [])[lineIdx];
        const { data: orig } = await db.from("purchase_items").select("*").eq("id", line.purchase_item_id).maybeSingle();
        if (!orig) return fail(`Return line ${line.purchase_item_id} no longer matches a line of purchase ${purchase.purchase_no}; the return cannot be posted.`);
        if (orig.item_type === "seed" && purchase.godown_id) {
          await stockEntry(db, {
            date: ret.date, voucherType: "purchase_return", voucherId: ret.id,
            voucherNo: ret.return_no, godownId: purchase.godown_id,
            productId: orig.product_id, partyId: purchase.vendor_id,
            inwardQty: 0, outwardQty: Number(line.quantity) || 0,
            notes: `Return against ${purchase.purchase_no}`, userId: gate.actor.userId, lineNo: lineIdx,
          });
        } else if (orig.item_type === "packaging") {
          await bardanaEntry(db, {
            date: ret.date, voucherType: "purchase_return", voucherId: ret.id,
            voucherNo: ret.return_no, packagingTypeId: orig.packaging_type_id,
            godownId: purchase.godown_id, inQty: 0,
            outQty: Math.round(Number(line.quantity) || 0),
            notes: `Return against ${purchase.purchase_no}`, userId: gate.actor.userId, lineNo: lineIdx,
          });
        }
      }
    }
    // Credit note: reduces what the business owes the vendor.
    await partyEntry(db, {
      partyId: purchase.vendor_id, date: ret.date, entryType: "purchase_return",
      voucherType: "purchase_return", voucherId: ret.id, voucherNo: ret.return_no,
      delta: roundMoney(Number(ret.total_amount) || 0),
      notes: `Credit note against ${purchase.purchase_no}`, userId: gate.actor.userId,
    });
    const { data: updated, error: uError } = await db
      .from("purchase_returns")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "purchase_returns", id, "posted");
      if (replayed) return { success: true, data: replayed };
      return fail("Return could not be posted (concurrent change?).");
    }
    // Keep the original purchase's outstanding honest: total - paid - returns.
    const { data: postedReturns } = await db
      .from("purchase_returns")
      .select("total_amount")
      .eq("purchase_id", purchase.id)
      .eq("status", "posted");
    const returnsTotal = (postedReturns ?? []).reduce(
      (s, r) => roundMoney(s + (Number(r.total_amount) || 0)), 0);
    await db.from("purchases").update({
      balance_amount: roundMoney(Number(purchase.total_amount) - Number(purchase.paid_amount) - returnsTotal),
    }).eq("id", purchase.id);
    await logAudit(db, {
      action: "return", entityType: "purchase_returns", entityId: id,
      voucherNo: ret.return_no, before: { status: "draft" },
      after: { status: "posted", total_amount: ret.total_amount },
      reason: ret.reason, userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    revalidatePath("/purchases");
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ---------------------------------------------------------------- invoices

export interface InvoiceLineInput {
  description: string;
  productId?: string | null;
  quantity?: number;
  unitPrice: number;
  sourceType?: string | null;
  sourceId?: string | null;
}

export async function listInvoices(filters: {
  customerId?: string;
  status?: string;
  sourceType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  // Header columns only: no caller reads invoice_lines from this list
  // (billing renders headers and balances; receipt print builds its own
  // allocations), so shipping every line with every invoice was pure
  // payload on every billing load.
  if (filters.page !== undefined) {
    const { page, pageSize, fromRow, toRow } = pageWindow(filters);
    let pq = db.from("customer_invoices").select("*", { count: "exact" }).order("date", { ascending: false });
    if (filters.customerId) pq = pq.eq("customer_id", filters.customerId);
    if (filters.status) pq = pq.eq("status", filters.status);
    if (filters.sourceType) pq = pq.eq("source_type", filters.sourceType);
    pq = dateRange(filters, pq as never) as typeof pq;
    const { data, error: qError, count } = await pq.range(fromRow, toRow);
    if (qError) return fail(qError.message);
    return { success: true, data: { rows: data, total: count ?? (data ?? []).length, page, pageSize } };
  }
  let q = db.from("customer_invoices").select("*").order("date", { ascending: false });
  if (filters.customerId) q = q.eq("customer_id", filters.customerId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.sourceType) q = q.eq("source_type", filters.sourceType);
  q = dateRange(filters, q as never) as typeof q;
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}

/**
 * Create a draft invoice from machinery/packing jobs or sales, with
 * source links on the header and lines. Posting (not creation) is the
 * revenue event. Line totals are computed here, never typed in as
 * independent totals that could drift from qty x price.
 */
export async function createInvoice(input: {
  customerId: string;
  sourceType: "machinery_job" | "packing" | "sale" | "manual";
  sourceId?: string | null;
  sourceRef?: string | null;
  date?: string;
  notes?: string;
  clientToken?: string;
  lines: InvoiceLineInput[];
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (input.clientToken) {
      const existing = await byToken(db, "customer_invoices", input.clientToken);
      if (existing) return { success: true, data: existing };
    }
    if (!input.customerId) return fail("customerId is required.");
    if (!input.lines?.length) return fail("At least one invoice line is required.");
    const lines = [];
    let total = 0;
    for (const line of input.lines) {
      const qty = nonNeg(line.quantity ?? 1, "quantity");
      const price = nonNeg(line.unitPrice, "unitPrice");
      if (qty === null || price === null) return fail("Line quantities and prices must be >= 0.");
      if (!line.description?.trim()) return fail("Each invoice line needs a description.");
      const lineTotal = roundMoney(qty * price);
      total = roundMoney(total + lineTotal);
      lines.push({
        description: line.description.trim(),
        product_id: line.productId ?? null,
        quantity: qty, unit_price: price, line_total: lineTotal,
        source_type: line.sourceType ?? null, source_id: line.sourceId ?? null,
      });
    }
    const { data, error: iError } = await db
      .from("customer_invoices")
      .insert({
        invoice_no: await nextDocNo(db, "invoice", "INV"), date: input.date ?? new Date().toISOString(),
        customer_id: input.customerId, source_type: input.sourceType,
        source_id: input.sourceId ?? null, source_ref: input.sourceRef ?? null,
        total_amount: total, paid_amount: 0, balance_amount: total,
        status: "draft", client_token: input.clientToken ?? null,
        notes: input.notes ?? null, created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError) return fail(iError.message);
    const { error: lError } = await db
      .from("invoice_lines")
      .insert(lines.map((l) => ({ ...l, invoice_id: data.id })));
    if (lError) return fail(lError.message);
    await logAudit(db, {
      action: "create", entityType: "customer_invoices", entityId: data.id,
      voucherNo: data.invoice_no, after: { total_amount: total, status: "draft", source_type: input.sourceType },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function postInvoice(id: string, opts: { reason?: string } = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  const { data: inv } = await db.from("customer_invoices").select("*").eq("id", id).single();
  if (!inv) return fail("Invoice not found.");
  if (inv.status === "posted") return { success: true, data: inv };
  if (inv.status !== "draft") return fail(`Only a draft invoice can be posted (status: ${inv.status}).`);
  try {
    await partyEntry(db, {
      partyId: inv.customer_id, date: inv.date, entryType: "invoice",
      voucherType: "invoice", voucherId: inv.id, voucherNo: inv.invoice_no,
      delta: roundMoney(Number(inv.total_amount) || 0),
      notes: `Posted invoice (${inv.source_type})`, userId: gate.actor.userId,
    });
    const { data: updated, error: uError } = await db
      .from("customer_invoices")
      .update({ status: "posted", posted_at: new Date().toISOString(), updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "customer_invoices", id, "posted");
      if (replayed) return { success: true, data: replayed };
      return fail("Invoice could not be posted (concurrent change?).");
    }
    await logAudit(db, {
      action: "post", entityType: "customer_invoices", entityId: id,
      voucherNo: inv.invoice_no, before: { status: "draft" },
      after: { status: "posted", total_amount: inv.total_amount },
      reason: opts.reason ?? null, userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function reverseInvoice(id: string, reason: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!reason?.trim()) return fail("A reason is mandatory to reverse a posted invoice.");
  const { data: inv } = await db.from("customer_invoices").select("*").eq("id", id).single();
  if (!inv) return fail("Invoice not found.");
  if (inv.status !== "posted") return fail("Only a posted invoice can be reversed.");
  if (Number(inv.paid_amount) > 0) {
    return fail("Invoice has receipts allocated; reverse the receipts first, then reverse the invoice.");
  }
  try {
    await partyEntry(db, {
      partyId: inv.customer_id, date: new Date().toISOString(), entryType: "reversal",
      voucherType: "invoice", voucherId: inv.id, voucherNo: `${inv.invoice_no}-R`,
      delta: -roundMoney(Number(inv.total_amount) || 0),
      notes: `Invoice reversal: ${reason}`, userId: gate.actor.userId,
    });
    const { data: updated, error: uError } = await db
      .from("customer_invoices")
      .update({ status: "reversed", reversal_reason: reason, balance_amount: 0, updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "customer_invoices", id, "reversed");
      if (replayed) return { success: true, data: replayed };
      return fail("Invoice could not be reversed (concurrent change?).");
    }
    await logAudit(db, {
      action: "reverse", entityType: "customer_invoices", entityId: id,
      voucherNo: inv.invoice_no, before: { status: "posted" },
      after: { status: "reversed" }, reason,
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ---------------------------------------------------------------- receipts

export async function listReceipts(filters: {
  customerId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  if (filters.page !== undefined) {
    const { page, pageSize, fromRow, toRow } = pageWindow(filters);
    let pq = db.from("customer_receipts").select("*, invoice_allocations(*)", { count: "exact" }).order("date", { ascending: false });
    if (filters.customerId) pq = pq.eq("customer_id", filters.customerId);
    if (filters.status) pq = pq.eq("status", filters.status);
    pq = dateRange(filters, pq as never) as typeof pq;
    const { data, error: qError, count } = await pq.range(fromRow, toRow);
    if (qError) return fail(qError.message);
    return { success: true, data: { rows: data, total: count ?? (data ?? []).length, page, pageSize } };
  }
  let q = db.from("customer_receipts").select("*, invoice_allocations(*)").order("date", { ascending: false });
  if (filters.customerId) q = q.eq("customer_id", filters.customerId);
  if (filters.status) q = q.eq("status", filters.status);
  q = dateRange(filters, q as never) as typeof q;
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}

/**
 * Create a DRAFT receipt with EXPLICIT allocations. Allocations may sum
 * to less than the receipt amount; the remainder is an unapplied advance
 * (stored on the receipt, never spread across invoices automatically).
 * Posting applies cash + receivable effects exactly once.
 */
export async function createReceipt(input: {
  customerId: string;
  cashAccountId?: string | null;
  account: "cash" | "bank" | "online";
  paymentMethod?: string;
  amount: number;
  referenceNo?: string;
  /** Optional: what the receipt is for (shown on the receipt print). */
  purpose?: string;
  /** Optional: person who received the money (shown on the receipt print). */
  receivedBy?: string;
  notes?: string;
  date?: string;
  clientToken?: string;
  allocations: { invoiceId: string; amount: number }[];
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (input.clientToken) {
      const existing = await byToken(db, "customer_receipts", input.clientToken);
      if (existing) return { success: true, data: existing };
    }
    const amount = pos(input.amount, "amount");
    if (amount === null) return fail("Receipt amount must be > 0.");
    const cashCheck = await validateCashAccount(db, input.cashAccountId, input.account);
    if (!cashCheck.ok) return fail(cashCheck.error);
    let allocated = 0;
    const allocRows = [];
    for (const a of input.allocations ?? []) {
      const amt = pos(a.amount, "allocation amount");
      if (amt === null) return fail("Each allocation amount must be > 0.");
      allocated = roundMoney(allocated + amt);
      allocRows.push({ invoice_id: a.invoiceId, amount: amt });
    }
    if (allocated > amount) {
      return fail(`Allocations (${allocated}) exceed the receipt amount (${amount}). The remainder must stay an explicit unapplied advance, not an over-allocation.`);
    }
    const { data, error: iError } = await db
      .from("customer_receipts")
      .insert({
        receipt_no: await nextDocNo(db, "receipt", "RCT"), date: input.date ?? new Date().toISOString(),
        customer_id: input.customerId, cash_account_id: input.cashAccountId ?? null,
        account: input.account, payment_method: input.paymentMethod ?? "cash",
        amount, unapplied_amount: roundMoney(amount - allocated),
        reference_no: input.referenceNo ?? null, notes: input.notes ?? null,
        purpose: input.purpose?.trim() || null,
        received_by: input.receivedBy?.trim() || null,
        status: "draft", client_token: input.clientToken ?? null,
        created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError) return fail(iError.message);
    if (allocRows.length) {
      const { error: aError } = await db
        .from("invoice_allocations")
        .insert(allocRows.map((r) => ({ ...r, receipt_id: data.id })));
      if (aError) return fail(aError.message);
    }
    return { success: true, data };
  } catch (err) {
    return fail(errMsg(err));
  }
}

async function refreshInvoicePaid(db: Db, invoiceId: string): Promise<void> {
  const { data: allocs } = await db.from("invoice_allocations").select("amount, receipt_id").eq("invoice_id", invoiceId);
  let paid = 0;
  for (const a of allocs ?? []) {
    const { data: receipt } = await db.from("customer_receipts").select("status").eq("id", a.receipt_id).maybeSingle();
    if (receipt?.status === "posted") paid = roundMoney(paid + (Number(a.amount) || 0));
  }
  const { data: inv } = await db.from("customer_invoices").select("total_amount").eq("id", invoiceId).maybeSingle();
  if (!inv) return;
  await db.from("customer_invoices").update({
    paid_amount: paid,
    balance_amount: roundMoney(Number(inv.total_amount) - paid),
  }).eq("id", invoiceId);
}

export async function postReceipt(id: string, opts: { reason?: string } = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    const { data: receipt } = await db.from("customer_receipts").select("*").eq("id", id).single();
    if (!receipt) return fail("Receipt not found.");
    if (receipt.status === "posted") return { success: true, data: receipt };
    if (receipt.status !== "draft") return fail(`Only a draft receipt can be posted (status: ${receipt.status}).`);
    // Receipts drafted before cash accounts were required may carry a
    // NULL account; posting one would write a NULL cash row.
    const receiptCashCheck = await validateCashAccount(db, receipt.cash_account_id, receipt.account);
    if (!receiptCashCheck.ok) return fail(receiptCashCheck.error);
    const { data: allocs } = await db.from("invoice_allocations").select("*").eq("receipt_id", id);
    for (const a of allocs ?? []) {
      const { data: inv } = await db.from("customer_invoices").select("*").eq("id", a.invoice_id).maybeSingle();
      if (!inv || inv.status !== "posted") return fail(`Allocation target invoice ${a.invoice_id} is not a posted invoice.`);
      if (Number(a.amount) > Number(inv.balance_amount)) {
        return fail(`Allocation of ${a.amount} exceeds invoice ${inv.invoice_no} balance ${inv.balance_amount}.`);
      }
    }
    // Cash in (collection, NOT revenue) + receivable down.
    await cashEntry(db, {
      date: receipt.date, voucherType: "receipt", voucherId: receipt.id,
      voucherNo: receipt.receipt_no, account: receipt.account,
      cashAccountId: receipt.cash_account_id, debit: roundMoney(Number(receipt.amount) || 0),
      credit: 0, description: `Receipt from customer (${receipt.receipt_no})`,
      settlementKind: "receipt", userId: gate.actor.userId,
    });
    await partyEntry(db, {
      partyId: receipt.customer_id, date: receipt.date, entryType: "receipt",
      voucherType: "receipt", voucherId: receipt.id, voucherNo: receipt.receipt_no,
      delta: -roundMoney(Number(receipt.amount) || 0),
      notes: "Cash collection against receivable / advance", userId: gate.actor.userId,
    });
    const { data: updated, error: uError } = await db
      .from("customer_receipts")
      .update({ status: "posted", posted_at: new Date().toISOString(), updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "customer_receipts", id, "posted");
      if (replayed) return { success: true, data: replayed };
      return fail("Receipt could not be posted (concurrent change?).");
    }
    for (const a of allocs ?? []) await refreshInvoicePaid(db, a.invoice_id);
    await logAudit(db, {
      action: "post", entityType: "customer_receipts", entityId: id,
      voucherNo: receipt.receipt_no, before: { status: "draft" },
      after: { status: "posted", amount: receipt.amount, unapplied_amount: receipt.unapplied_amount },
      reason: opts.reason ?? null, userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function reverseReceipt(id: string, reason: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!reason?.trim()) return fail("A reason is mandatory to reverse a posted receipt.");
  try {
    const { data: receipt } = await db.from("customer_receipts").select("*").eq("id", id).single();
    if (!receipt) return fail("Receipt not found.");
    if (receipt.status !== "posted") return fail("Only a posted receipt can be reversed.");
    const { data: allocs } = await db.from("invoice_allocations").select("*").eq("receipt_id", id);
    await cashEntry(db, {
      date: new Date().toISOString(), voucherType: "receipt_reversal", voucherId: receipt.id,
      voucherNo: `${receipt.receipt_no}-R`, account: receipt.account,
      cashAccountId: receipt.cash_account_id, debit: 0,
      credit: roundMoney(Number(receipt.amount) || 0),
      description: `Receipt reversal: ${reason}`, settlementKind: "receipt",
      userId: gate.actor.userId,
    });
    await partyEntry(db, {
      partyId: receipt.customer_id, date: new Date().toISOString(), entryType: "reversal",
      voucherType: "receipt", voucherId: receipt.id, voucherNo: `${receipt.receipt_no}-R`,
      delta: roundMoney(Number(receipt.amount) || 0),
      notes: `Receipt reversal: ${reason}`, userId: gate.actor.userId,
    });
    const { data: updated, error: uError } = await db
      .from("customer_receipts")
      .update({ status: "reversed", reversal_reason: reason, updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "customer_receipts", id, "reversed");
      if (replayed) return { success: true, data: replayed };
      return fail("Receipt could not be reversed (concurrent change?).");
    }
    for (const a of allocs ?? []) await refreshInvoicePaid(db, a.invoice_id);
    await logAudit(db, {
      action: "reverse", entityType: "customer_receipts", entityId: id,
      voucherNo: receipt.receipt_no, before: { status: "posted" },
      after: { status: "reversed" }, reason,
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ------------------------------------------------------- vendor payments

export async function listVendorPayments(filters: {
  vendorId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  if (filters.page !== undefined) {
    const { page, pageSize, fromRow, toRow } = pageWindow(filters);
    let pq = db.from("vendor_payments").select("*, payment_allocations(*)", { count: "exact" }).order("date", { ascending: false });
    if (filters.vendorId) pq = pq.eq("vendor_id", filters.vendorId);
    if (filters.status) pq = pq.eq("status", filters.status);
    pq = dateRange(filters, pq as never) as typeof pq;
    const { data, error: qError, count } = await pq.range(fromRow, toRow);
    if (qError) return fail(qError.message);
    return { success: true, data: { rows: data, total: count ?? (data ?? []).length, page, pageSize } };
  }
  let q = db.from("vendor_payments").select("*, payment_allocations(*)").order("date", { ascending: false });
  if (filters.vendorId) q = q.eq("vendor_id", filters.vendorId);
  if (filters.status) q = q.eq("status", filters.status);
  q = dateRange(filters, q as never) as typeof q;
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}

async function refreshPurchasePaid(db: Db, purchaseId: string): Promise<void> {
  const { data: allocs } = await db.from("payment_allocations").select("amount, payment_id").eq("target_type", "purchase").eq("target_id", purchaseId);
  let paid = 0;
  for (const a of allocs ?? []) {
    const { data: pay } = await db.from("vendor_payments").select("status").eq("id", a.payment_id).maybeSingle();
    if (pay?.status === "posted") paid = roundMoney(paid + (Number(a.amount) || 0));
  }
  const { data: pur } = await db.from("purchases").select("total_amount").eq("id", purchaseId).maybeSingle();
  if (!pur) return;
  const { data: postedReturns } = await db.from("purchase_returns").select("total_amount").eq("purchase_id", purchaseId).eq("status", "posted");
  const returnsTotal = (postedReturns ?? []).reduce((s, r) => roundMoney(s + (Number(r.total_amount) || 0)), 0);
  await db.from("purchases").update({
    paid_amount: paid,
    balance_amount: roundMoney(Number(pur.total_amount) - paid - returnsTotal),
  }).eq("id", purchaseId);
}

async function refreshExpensePaid(db: Db, expenseId: string): Promise<void> {
  const { data: allocs } = await db.from("payment_allocations").select("amount, payment_id").eq("target_type", "expense").eq("target_id", expenseId);
  let paid = 0;
  for (const a of allocs ?? []) {
    const { data: pay } = await db.from("vendor_payments").select("status").eq("id", a.payment_id).maybeSingle();
    if (pay?.status === "posted") paid = roundMoney(paid + (Number(a.amount) || 0));
  }
  const { data: exp } = await db.from("expenses").select("amount").eq("id", expenseId).maybeSingle();
  if (!exp) return;
  await db.from("expenses").update({
    paid_amount: paid,
    balance_amount: roundMoney(Number(exp.amount) - paid),
  }).eq("id", expenseId);
}

/**
 * Create AND post a vendor payment with EXPLICIT allocations to specific
 * purchases (and/or credit expenses / payroll periods). The cash outflow
 * and the payable reduction happen here, once; stock is never touched.
 * Allocations may total less than the payment (remainder = unallocated
 * advance to the vendor, recorded in notes/parties via party_ledger).
 */
export async function allocatePayment(input: {
  vendorId: string;
  cashAccountId?: string | null;
  account: "cash" | "bank" | "online";
  paymentMethod?: string;
  amount: number;
  settlementKind?: "purchase" | "expense" | "payroll" | "other";
  referenceNo?: string;
  notes?: string;
  date?: string;
  clientToken?: string;
  allocations: { targetType: "purchase" | "expense" | "payroll"; targetId: string; amount: number }[];
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (input.clientToken) {
      const existing = await byToken(db, "vendor_payments", input.clientToken);
      if (existing) return { success: true, data: existing };
    }
    const amount = pos(input.amount, "amount");
    if (amount === null) return fail("Payment amount must be > 0.");
    // Cash must land in a real account (see validateCashAccount).
    const cashCheck = await validateCashAccount(db, input.cashAccountId, input.account);
    if (!cashCheck.ok) return fail(cashCheck.error);
    // Aggregate duplicate targets FIRST: two lines to the same purchase
    // previously each passed the balance check alone and then either
    // over-allocated together or hit the allocations unique key.
    const allocations: { targetType: "purchase" | "expense" | "payroll"; targetId: string; amount: number }[] = [];
    for (const a of input.allocations ?? []) {
      const amt = pos(a.amount, "allocation amount");
      if (amt === null) return fail("Each allocation amount must be > 0.");
      allocations.push({ targetType: a.targetType, targetId: a.targetId, amount: amt });
    }
    const merged = aggregateAllocations(allocations) as typeof allocations;
    const allocated = merged.reduce((s, a) => roundMoney(s + a.amount), 0);
    if (allocated > amount) return fail(`Allocations (${allocated}) exceed the payment amount (${amount}).`);
    // Validate targets before moving any money, including the vendor
    // match: a payment from vendor A must never settle vendor B's
    // purchase or expense. Payroll targets carry no vendor, so the
    // match check does not apply to them.
    for (const a of merged) {
      if (a.targetType === "purchase") {
        const { data: pur } = await db.from("purchases").select("*").eq("id", a.targetId).maybeSingle();
        if (!pur || pur.status !== "posted") return fail(`Purchase ${a.targetId} is not posted.`);
        if (pur.vendor_id !== input.vendorId) return fail(`Purchase ${pur.purchase_no} belongs to another vendor; it cannot be settled by this vendor's payment.`);
        if (Number(a.amount) > Number(pur.balance_amount)) return fail(`Allocation exceeds purchase ${pur.purchase_no} balance.`);
      } else if (a.targetType === "expense") {
        const { data: exp } = await db.from("expenses").select("*").eq("id", a.targetId).maybeSingle();
        if (!exp || exp.status !== "posted" || exp.settlement !== "credit") return fail(`Expense ${a.targetId} is not a posted credit expense.`);
        if (!exp.vendor_id) return fail(`Expense ${exp.expense_no} has no vendor, so no vendor payment can settle it.`);
        if (exp.vendor_id !== input.vendorId) return fail(`Expense ${exp.expense_no} belongs to another vendor; it cannot be settled by this vendor's payment.`);
        if (Number(a.amount) > Number(exp.balance_amount)) return fail(`Allocation exceeds expense ${exp.expense_no} balance.`);
      } else {
        const { data: pr } = await db.from("payroll_periods").select("*").eq("id", a.targetId).maybeSingle();
        if (!pr || !["approved", "partially_paid"].includes(pr.status)) return fail(`Payroll ${a.targetId} is not approved for payment.`);
        if (Number(a.amount) > Number(pr.balance_amount)) return fail(`Allocation exceeds payroll balance.`);
      }
    }
    const settlementKind = input.settlementKind ?? "purchase";
    const voucherType = settlementKind === "payroll" ? "payroll"
      : settlementKind === "expense" ? "expense_pay" : "purchase_pay";
    const { data: payment, error: iError } = await db
      .from("vendor_payments")
      .insert({
        payment_no: await nextDocNo(db, "vendor_payment", "PAY"), date: input.date ?? new Date().toISOString(),
        vendor_id: input.vendorId, cash_account_id: input.cashAccountId ?? null,
        account: input.account, payment_method: input.paymentMethod ?? "cash",
        amount, settlement_kind: settlementKind, reference_no: input.referenceNo ?? null,
        notes: input.notes ?? null, status: "posted",
        posted_at: new Date().toISOString(), client_token: input.clientToken ?? null,
        created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError) return fail(iError.message);
    if (merged.length) {
      const { error: aError } = await db.from("payment_allocations").insert(
        merged.map((a) => ({
          payment_id: payment.id, target_type: a.targetType, target_id: a.targetId, amount: a.amount,
        })),
      );
      if (aError) return fail(aError.message);
    }
    await cashEntry(db, {
      date: payment.date, voucherType, voucherId: payment.id, voucherNo: payment.payment_no,
      account: input.account, cashAccountId: input.cashAccountId,
      debit: 0, credit: amount,
      description: `Vendor payment (${payment.payment_no}, ${settlementKind})`,
      settlementKind, userId: gate.actor.userId,
    });
    await partyEntry(db, {
      partyId: input.vendorId, date: payment.date, entryType: "payment",
      voucherType, voucherId: payment.id, voucherNo: payment.payment_no,
      delta: amount, notes: "Vendor payable settled (allocations + any unallocated advance)",
      userId: gate.actor.userId,
    });
    for (const a of merged) {
      if (a.targetType === "purchase") await refreshPurchasePaid(db, a.targetId);
      else if (a.targetType === "expense") await refreshExpensePaid(db, a.targetId);
      else {
        const { data: pr } = await db.from("payroll_periods").select("*").eq("id", a.targetId).maybeSingle();
        if (pr) {
          const paid = roundMoney(Number(pr.paid_amount) + Number(a.amount));
          const balance = roundMoney(Number(pr.net_payable) - paid);
          await db.from("payroll_periods").update({
            paid_amount: paid, balance_amount: balance,
            status: balance <= 0 ? "paid" : "partially_paid",
          }).eq("id", a.targetId);
          await db.from("payroll_payments").insert({
            payroll_id: a.targetId, date: payment.date, amount: a.amount,
            payment_method: input.paymentMethod ?? "cash",
            cash_account_id: input.cashAccountId ?? null, account: input.account,
            reference_no: input.referenceNo ?? null, notes: `Via vendor payment ${payment.payment_no}`,
            created_by: gate.actor.userId,
          });
        }
      }
    }
    await logAudit(db, {
      action: "post", entityType: "vendor_payments", entityId: payment.id,
      voucherNo: payment.payment_no, after: { status: "posted", amount, settlement_kind: settlementKind },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: payment };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function reverseVendorPayment(id: string, reason: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!reason?.trim()) return fail("A reason is mandatory to reverse a posted payment.");
  try {
    const { data: pay } = await db.from("vendor_payments").select("*").eq("id", id).single();
    if (!pay) return fail("Payment not found.");
    if (pay.status !== "posted") return fail("Only a posted payment can be reversed.");
    const { data: allocs } = await db.from("payment_allocations").select("*").eq("payment_id", id);
    await cashEntry(db, {
      date: new Date().toISOString(), voucherType: "payment_reversal", voucherId: pay.id,
      voucherNo: `${pay.payment_no}-R`, account: pay.account, cashAccountId: pay.cash_account_id,
      debit: roundMoney(Number(pay.amount) || 0), credit: 0,
      description: `Payment reversal: ${reason}`, settlementKind: pay.settlement_kind,
      userId: gate.actor.userId,
    });
    await partyEntry(db, {
      partyId: pay.vendor_id, date: new Date().toISOString(), entryType: "reversal",
      voucherType: "payment", voucherId: pay.id, voucherNo: `${pay.payment_no}-R`,
      delta: -roundMoney(Number(pay.amount) || 0),
      notes: `Payment reversal: ${reason}`, userId: gate.actor.userId,
    });
    const { data: updated, error: uError } = await db
      .from("vendor_payments")
      .update({ status: "reversed", reversal_reason: reason, updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "vendor_payments", id, "reversed");
      if (replayed) return { success: true, data: replayed };
      return fail("Payment could not be reversed (concurrent change?).");
    }
    for (const a of allocs ?? []) {
      if (a.target_type === "purchase") await refreshPurchasePaid(db, a.target_id);
      else if (a.target_type === "expense") await refreshExpensePaid(db, a.target_id);
      else {
        const { data: pr } = await db.from("payroll_periods").select("*").eq("id", a.target_id).maybeSingle();
        if (pr) {
          // Only this allocation is unwound: direct payPayroll payments
          // (payroll_payments rows) are untouched, so paid is decremented
          // by exactly this allocation rather than recomputed from
          // allocations alone (which would erase direct payments).
          const paid = Math.max(0, roundMoney(Number(pr.paid_amount) - Number(a.amount)));
          const balance = roundMoney(Number(pr.net_payable) - paid);
          await db.from("payroll_periods").update({
            paid_amount: paid,
            balance_amount: balance,
            status: paid <= 0 ? "approved" : balance <= 0 ? "paid" : "partially_paid",
          }).eq("id", a.target_id);
          // Remove the payroll_payments row this payment created, or
          // payroll history keeps showing money that was reversed.
          // payroll_payments carries no payment link, so the match is
          // the exact note allocatePayment wrote, plus payroll + amount.
          await db.from("payroll_payments").delete()
            .eq("payroll_id", a.target_id)
            .eq("amount", Number(a.amount))
            .eq("notes", `Via vendor payment ${pay.payment_no}`);
        }
      }
    }
    await logAudit(db, {
      action: "reverse", entityType: "vendor_payments", entityId: id,
      voucherNo: pay.payment_no, before: { status: "posted" },
      after: { status: "reversed" }, reason,
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ---------------------------------------------------------------- expenses

export async function listExpenses(filters: {
  status?: string;
  categoryName?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  if (filters.page !== undefined) {
    const { page, pageSize, fromRow, toRow } = pageWindow(filters);
    let pq = db.from("expenses").select("*", { count: "exact" }).order("date", { ascending: false });
    if (filters.status) pq = pq.eq("status", filters.status);
    if (filters.categoryName) pq = pq.eq("category_name", filters.categoryName);
    pq = dateRange(filters, pq as never) as typeof pq;
    const { data, error: qError, count } = await pq.range(fromRow, toRow);
    if (qError) return fail(qError.message);
    return { success: true, data: { rows: data, total: count ?? (data ?? []).length, page, pageSize } };
  }
  let q = db.from("expenses").select("*").order("date", { ascending: false });
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.categoryName) q = q.eq("category_name", filters.categoryName);
  q = dateRange(filters, q as never) as typeof q;
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}

// ------------------------------------------------------- expense categories

/** Expense categories from the expense_categories table (never hardcoded). */
export async function listExpenseCategories(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  if (cachedExpenseCategories && Date.now() < cachedExpenseCategories.expires) {
    const data = cachedExpenseCategories.data;
    return { success: true, data: Array.isArray(data) ? [...data] : data };
  }
  if (expenseCategoriesPending) return expenseCategoriesPending;
  const generation = expenseCategoriesGeneration;
  let fetchPromise: Promise<ActionResult> | null = null;
  fetchPromise = (async () => {
    try {
      const { data, error: qError } = await db
        .from("expense_categories")
        .select("*")
        .order("name", { ascending: true });
      if (qError) return fail(qError.message);
      if (generation === expenseCategoriesGeneration) {
        cachedExpenseCategories = {
          data,
          expires: Date.now() + FINANCE_REFERENCE_TTL_MS,
        };
      }
      return { success: true, data };
    } finally {
      if (expenseCategoriesPending === fetchPromise) {
        expenseCategoriesPending = null;
      }
    }
  })();
  expenseCategoriesPending = fetchPromise;
  return fetchPromise;
}

export async function createExpenseCategory(input: {
  name: string;
  description?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!input.name?.trim()) return fail("Expense category name is required.");
  const { data, error: iError } = await db
    .from("expense_categories")
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_operating: true,
      is_active: true,
    })
    .select()
    .single();
  if (iError) return fail(iError.message);
  clearExpenseCategoriesCache();
  await logAudit(db, {
    action: "create", entityType: "expense_categories", entityId: data.id,
    after: { name: input.name.trim() },
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/daybook");
  revalidatePath("/ledgers");
  return { success: true, data };
}

export async function updateExpenseCategory(input: {
  id: string;
  name?: string;
  description?: string | null;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!input.id) return fail("id is required.");
  if (input.name !== undefined && !input.name.trim()) {
    return fail("Expense category name is required.");
  }
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (Object.keys(patch).length === 0) return fail("Nothing to update.");
  const { data: before } = await db.from("expense_categories").select("*").eq("id", input.id).maybeSingle();
  if (!before) return fail("Expense category not found.");
  const { data, error: uError } = await db
    .from("expense_categories")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  clearExpenseCategoriesCache();
  await logAudit(db, {
    action: "update", entityType: "expense_categories", entityId: input.id,
    before: before as Record<string, unknown>, after: patch,
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/daybook");
  revalidatePath("/ledgers");
  return { success: true, data };
}

export async function deactivateExpenseCategory(id: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  const { data, error: uError } = await db
    .from("expense_categories")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  clearExpenseCategoriesCache();
  await logAudit(db, {
    action: "deactivate", entityType: "expense_categories", entityId: id,
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/daybook");
  revalidatePath("/ledgers");
  return { success: true, data };
}

async function setExpenseCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!id) return fail("id is required.");
  const { data, error: uError } = await db
    .from("expense_categories")
    .update({ is_active: active })
    .eq("id", id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  clearExpenseCategoriesCache();
  await logAudit(db, {
    action: active ? "reactivate" : "deactivate", entityType: "expense_categories", entityId: id,
    before: { is_active: !active }, after: { is_active: active },
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/daybook");
  revalidatePath("/ledgers");
  return { success: true, data };
}

export async function reactivateExpenseCategory(id: string): Promise<ActionResult> {
  return setExpenseCategoryActive(id, true);
}

/**
 * Create a draft expense. settlement = 'paid' means cash/bank outflow on
 * posting; 'credit' means an unpaid payable (NO cash outflow on posting)
 * settled later via allocatePayment with targetType 'expense'.
 */
export async function createExpense(input: {
  categoryName: string;
  categoryId?: string | null;
  payee: string;
  vendorId?: string | null;
  amount: number;
  settlement?: "paid" | "credit";
  cashAccountId?: string | null;
  paymentMethod?: "cash" | "bank";
  /** Optional: where the expense was incurred (godown, site, …). */
  location?: string;
  /** Reference-only attachment link + note (never required). */
  attachmentUrl?: string;
  attachmentNote?: string;
  description?: string;
  date?: string;
  clientToken?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (input.clientToken) {
      const existing = await byToken(db, "expenses", input.clientToken);
      if (existing) return { success: true, data: existing };
    }
    const amount = pos(input.amount, "amount");
    if (amount === null) return fail("Expense amount must be > 0.");
    if (!input.categoryName?.trim() || !input.payee?.trim()) {
      return fail("Expense category and payee are required.");
    }
    const settlement = input.settlement ?? "paid";
    // A credit expense with no vendor posts with zero ledger effect
    // yet shows as posted — a payable owed to nobody. Block it here.
    if (settlement === "credit" && !input.vendorId) {
      return fail("A credit expense needs a vendor: the unpaid amount has to be owed to someone.");
    }
    // A paid expense moves cash, so it needs a real cash account (and
    // one whose kind matches the payment method).
    if (settlement === "paid") {
      const cashCheck = await validateCashAccount(db, input.cashAccountId, input.paymentMethod ?? "cash");
      if (!cashCheck.ok) return fail(cashCheck.error);
    } else if (input.cashAccountId) {
      // Credit expenses move no cash, so only existence is checked —
      // the kind match is a paid-expense rule.
      const { data: acct } = await db.from("cash_accounts").select("id").eq("id", input.cashAccountId).maybeSingle();
      if (!acct) return fail("The selected cash account does not exist.");
    }
    const expenseNo = await nextDocNo(db, "expense", "EXP");
    const { data, error: iError } = await db
      .from("expenses")
      .insert({
        expense_no: expenseNo, date: input.date ?? new Date().toISOString(),
        category_name: input.categoryName.trim(), category_id: input.categoryId ?? null,
        payee: input.payee.trim(), vendor_id: input.vendorId ?? null,
        amount, payment_method: input.paymentMethod ?? "cash",
        cash_account_id: input.cashAccountId ?? null, settlement,
        location: input.location?.trim() || null,
        attachment_url: input.attachmentUrl?.trim() || null,
        attachment_note: input.attachmentNote?.trim() || null,
        paid_amount: 0, balance_amount: amount,
        description: input.description ?? null, status: "draft",
        client_token: input.clientToken ?? null, created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError && /column .* does not exist/i.test(iError.message)) {
      const { data: retryData, error: rError } = await db
        .from("expenses")
        .insert({
          expense_no: expenseNo, date: input.date ?? new Date().toISOString(),
          category_name: input.categoryName.trim(), category_id: input.categoryId ?? null,
          payee: input.payee.trim(), vendor_id: input.vendorId ?? null,
          amount, payment_method: input.paymentMethod ?? "cash",
          cash_account_id: input.cashAccountId ?? null, settlement,
          location: input.location?.trim() || null,
          paid_amount: 0, balance_amount: amount,
          description: input.description ?? null, status: "draft",
          client_token: input.clientToken ?? null,
        })
        .select()
        .single();
      if (rError) return fail(rError.message);
      return { success: true, data: retryData };
    }
    if (iError) return fail(iError.message);
    return { success: true, data };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function postExpense(id: string, opts: { reason?: string } = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    const { data: exp } = await db.from("expenses").select("*").eq("id", id).single();
    if (!exp) return fail("Expense not found.");
    if (exp.status === "posted") return { success: true, data: exp };
    if (exp.status !== "draft") return fail(`Only a draft expense can be posted (status: ${exp.status}).`);
    if (exp.settlement === "credit" && !exp.vendor_id) {
      return fail("A credit expense needs a vendor; this draft has none, so posting it would record a payable owed to nobody.");
    }
    if (exp.settlement === "paid") {
      // Paid drafts written before cash accounts were required may
      // still carry a NULL account; posting one would write a NULL
      // cash row, so they fail closed instead.
      const cashCheck = await validateCashAccount(db, exp.cash_account_id, exp.payment_method);
      if (!cashCheck.ok) return fail(cashCheck.error);
      // Cash outflow, once. The account kind comes from the payment method;
      // a precise cash_account_id is used when one was chosen.
      await cashEntry(db, {
        date: exp.date, voucherType: "expense", voucherId: exp.id,
        voucherNo: exp.expense_no, account: exp.payment_method,
        cashAccountId: exp.cash_account_id, debit: 0,
        credit: roundMoney(Number(exp.amount) || 0),
        description: `Expense: ${exp.category_name} — ${exp.payee}`,
        settlementKind: "expense", userId: gate.actor.userId,
      });
    } else if (exp.vendor_id) {
      // Unpaid expense = payable, not a cash outflow (spec §12.1).
      await partyEntry(db, {
        partyId: exp.vendor_id, date: exp.date, entryType: "expense_credit",
        voucherType: "expense", voucherId: exp.id, voucherNo: exp.expense_no,
        delta: -roundMoney(Number(exp.amount) || 0),
        notes: `Unpaid expense: ${exp.category_name}`, userId: gate.actor.userId,
      });
    }
    const paid = exp.settlement === "paid" ? roundMoney(Number(exp.amount) || 0) : 0;
    const { data: updated, error: uError } = await db
      .from("expenses")
      .update({
        status: "posted", posted_at: new Date().toISOString(), updated_by: gate.actor.userId,
        paid_amount: paid,
        balance_amount: roundMoney(Number(exp.amount) - paid),
      })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "expenses", id, "posted");
      if (replayed) return { success: true, data: replayed };
      return fail("Expense could not be posted (concurrent change?).");
    }
    await logAudit(db, {
      action: "post", entityType: "expenses", entityId: id,
      voucherNo: exp.expense_no, before: { status: "draft" },
      after: { status: "posted", amount: exp.amount, settlement: exp.settlement },
      reason: opts.reason ?? null, userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function reverseExpense(id: string, reason: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!reason?.trim()) return fail("A reason is mandatory to reverse a posted expense.");
  try {
    const { data: exp } = await db.from("expenses").select("*").eq("id", id).single();
    if (!exp) return fail("Expense not found.");
    if (exp.status !== "posted") return fail("Only a posted expense can be reversed.");
    if (exp.settlement === "credit" && Number(exp.paid_amount) > 0) {
      return fail("Credit expense has payments allocated; reverse the payments first.");
    }
    if (exp.settlement === "paid") {
      await cashEntry(db, {
        date: new Date().toISOString(), voucherType: "expense_reversal", voucherId: exp.id,
        voucherNo: `${exp.expense_no}-R`, account: exp.payment_method,
        cashAccountId: exp.cash_account_id, debit: roundMoney(Number(exp.amount) || 0),
        credit: 0, description: `Expense reversal: ${reason}`,
        settlementKind: "expense", userId: gate.actor.userId,
      });
    } else if (exp.vendor_id) {
      await partyEntry(db, {
        partyId: exp.vendor_id, date: new Date().toISOString(), entryType: "reversal",
        voucherType: "expense", voucherId: exp.id, voucherNo: `${exp.expense_no}-R`,
        delta: roundMoney(Number(exp.amount) || 0),
        notes: `Expense reversal: ${reason}`, userId: gate.actor.userId,
      });
    }
    const { data: updated, error: uError } = await db
      .from("expenses")
      .update({ status: "reversed", reversal_reason: reason, paid_amount: 0, balance_amount: 0, updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) {
      const replayed = await replayIfFlipped(db, "expenses", id, "reversed");
      if (replayed) return { success: true, data: replayed };
      return fail("Expense could not be reversed (concurrent change?).");
    }
    await logAudit(db, {
      action: "reverse", entityType: "expenses", entityId: id,
      voucherNo: exp.expense_no, before: { status: "posted" },
      after: { status: "reversed" }, reason,
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

/**
 * Edit an expense. DRAFT ONLY: a posted expense has already written
 * cash and/or party ledger rows, so changing its amount or account
 * afterwards would desync the ledgers — posted expenses are corrected
 * by reversal, never by edit. A draft has written nothing, so every
 * field that createExpense accepts (except attachments, which stay as
 * created) may change here, under the same guards as creation: a paid
 * expense needs a real account of the payment method's kind, a credit
 * expense needs a vendor, and a named category must exist.
 */
export async function updateExpense(input: {
  id: string;
  categoryName?: string;
  categoryId?: string | null;
  payee?: string;
  vendorId?: string | null;
  amount?: number;
  settlement?: "paid" | "credit";
  cashAccountId?: string | null;
  paymentMethod?: "cash" | "bank";
  location?: string | null;
  description?: string | null;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!input.id) return fail("id is required.");
  const { data: exp } = await db.from("expenses").select("*").eq("id", input.id).maybeSingle();
  if (!exp) return fail("Expense not found.");
  if (exp.status !== "draft") {
    return fail(`Only a draft expense can be edited (status: ${exp.status}). Reverse a posted expense instead.`);
  }
  if (input.categoryName !== undefined && !input.categoryName.trim()) {
    return fail("Expense category is required.");
  }
  if (input.payee !== undefined && !input.payee.trim()) {
    return fail("Payee is required.");
  }
  let amount: number | undefined;
  if (input.amount !== undefined) {
    const checked = pos(input.amount, "amount");
    if (checked === null) return fail("Expense amount must be > 0.");
    amount = checked;
  }
  const settlement = input.settlement ?? (exp.settlement as "paid" | "credit");
  const vendorId = input.vendorId !== undefined ? input.vendorId : (exp.vendor_id as string | null);
  if (settlement === "credit" && !vendorId) {
    return fail("A credit expense needs a vendor: the unpaid amount has to be owed to someone.");
  }
  const paymentMethod = input.paymentMethod ?? (exp.payment_method as "cash" | "bank");
  const cashAccountId = input.cashAccountId !== undefined ? input.cashAccountId : (exp.cash_account_id as string | null);
  if (settlement === "paid") {
    const cashCheck = await validateCashAccount(db, cashAccountId, paymentMethod);
    if (!cashCheck.ok) return fail(cashCheck.error);
  } else if (cashAccountId) {
    const { data: acct } = await db.from("cash_accounts").select("id").eq("id", cashAccountId).maybeSingle();
    if (!acct) return fail("The selected cash account does not exist.");
  }
  if (input.categoryId !== undefined && input.categoryId) {
    const { data: cat } = await db.from("expense_categories").select("id").eq("id", input.categoryId).maybeSingle();
    if (!cat) return fail("The selected expense category does not exist.");
  }
  const patch: Record<string, unknown> = {};
  if (input.categoryName !== undefined) patch.category_name = input.categoryName.trim();
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.payee !== undefined) patch.payee = input.payee.trim();
  if (input.vendorId !== undefined) patch.vendor_id = input.vendorId;
  if (amount !== undefined) patch.amount = amount;
  if (input.settlement !== undefined) patch.settlement = input.settlement;
  if (input.cashAccountId !== undefined) patch.cash_account_id = input.cashAccountId;
  if (input.paymentMethod !== undefined) patch.payment_method = input.paymentMethod;
  if (input.location !== undefined) patch.location = input.location?.trim() || null;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (Object.keys(patch).length === 0) return fail("Nothing to update.");
  // A draft's balance is its full amount until it posts or is settled.
  if (amount !== undefined) patch.balance_amount = amount;
  const { data, error: uError } = await db
    .from("expenses")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  await logAudit(db, {
    action: "update", entityType: "expenses", entityId: input.id,
    voucherNo: exp.expense_no, before: exp as Record<string, unknown>, after: patch,
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  revalidatePath("/daybook");
  revalidatePath("/ledgers");
  return { success: true, data };
}

// ------------------------------------------------------- transfers & daybook

/**
 * Internal transfer: reduces one account and increases the other by the
 * same amount. It is never revenue or expense and touches no party.
 */
export async function postTransfer(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date?: string;
  referenceNo?: string;
  notes?: string;
  clientToken?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (input.clientToken) {
      const existing = await byToken(db, "cash_transfers", input.clientToken);
      if (existing) return { success: true, data: existing };
    }
    if (input.fromAccountId === input.toAccountId) {
      return fail("Transfer accounts must differ.");
    }
    const amount = pos(input.amount, "amount");
    if (amount === null) return fail("Transfer amount must be > 0.");
    const { data: from } = await db.from("cash_accounts").select("*").eq("id", input.fromAccountId).maybeSingle();
    const { data: to } = await db.from("cash_accounts").select("*").eq("id", input.toAccountId).maybeSingle();
    if (!from || !to) return fail("Both transfer accounts must exist.");
    if (from.is_active === false || to.is_active === false) {
      return fail("Transfers cannot use an inactive cash account; reactivate it on the Masters page first.");
    }
    const transferNo = await nextDocNo(db, "transfer", "TRF");
    const date = input.date ?? new Date().toISOString();
    const { data, error: iError } = await db
      .from("cash_transfers")
      .insert({
        transfer_no: transferNo, date, from_account_id: input.fromAccountId,
        to_account_id: input.toAccountId, amount,
        reference_no: input.referenceNo ?? null, notes: input.notes ?? null,
        client_token: input.clientToken ?? null, created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError) return fail(iError.message);
    await cashEntry(db, {
      date, voucherType: "transfer", voucherId: data.id, voucherNo: transferNo,
      account: from.account_kind, cashAccountId: from.id, debit: 0, credit: amount,
      description: `Transfer out to ${to.name}`, settlementKind: "transfer", lineNo: 0,
      userId: gate.actor.userId,
    });
    await cashEntry(db, {
      date, voucherType: "transfer", voucherId: data.id, voucherNo: transferNo,
      account: to.account_kind, cashAccountId: to.id, debit: amount, credit: 0,
      description: `Transfer in from ${from.name}`, settlementKind: "transfer", lineNo: 1,
      userId: gate.actor.userId,
    });
    await logAudit(db, {
      action: "post", entityType: "cash_transfers", entityId: data.id,
      voucherNo: transferNo, after: { amount, from: from.code, to: to.code },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function getDaybook(input: {
  accountId?: string;
  accountKind?: "cash" | "bank" | "online";
  from: string;
  to: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSensitiveRead(db);
  if ("error" in gate) return fail(gate.error);
  try {
    // The `to` day is inclusive: a plain YYYY-MM-DD bound becomes
    // `< next day` (B5), so today's rows are no longer dropped.
    const toExclusive = exclusiveToBound(input.to);
    const toDate = input.to.slice(0, 10);
    let accountLabel = input.accountKind ?? "all accounts";
    // Accounts that contribute a master opening to this view.
    let acctQuery = db.from("cash_accounts").select("id, code, name, account_kind, opening_balance, is_active");
    if (input.accountId) acctQuery = acctQuery.eq("id", input.accountId);
    else if (input.accountKind) acctQuery = acctQuery.eq("account_kind", input.accountKind).eq("is_active", true);
    else acctQuery = acctQuery.eq("is_active", true);
    const [{ data: openingAccts }, { data: allAccts }] = await Promise.all([
      acctQuery,
      db.from("cash_accounts").select("id, code, name, account_kind"),
    ]);
    if (input.accountId && !(openingAccts ?? []).length) return fail("Cash account not found.");
    if (input.accountId && openingAccts?.[0]) {
      const a = openingAccts[0] as Record<string, unknown>;
      accountLabel = `${a.code} — ${a.name}`;
    }
    const labelById = new Map<string, Record<string, unknown>>();
    for (const a of allAccts ?? []) labelById.set(String((a as Record<string, unknown>).id), a as Record<string, unknown>);

    // Per-account groups. A group key is the cash_account_id, or
    // `kind:<kind>` for legacy rows written before accounts existed
    // (NULL cash_account_id). Each group carries its own running
    // balance: the old single merged chain mixed unrelated accounts
    // into one meaningless column.
    type Group = { key: string; cashAccountId: string | null; code: string; name: string; accountKind: string; opening: number };
    const groups = new Map<string, Group>();
    const groupFor = (cashAccountId: string | null, kind: string): Group => {
      const key = cashAccountId ?? `kind:${kind}`;
      let g = groups.get(key);
      if (!g) {
        const acct = cashAccountId ? labelById.get(cashAccountId) : undefined;
        g = {
          key,
          cashAccountId,
          code: acct ? String(acct.code) : "—",
          name: acct ? String(acct.name) : `Unassigned ${kind} rows`,
          accountKind: acct ? String(acct.account_kind) : kind,
          opening: 0,
        };
        groups.set(key, g);
      }
      return g;
    };
    for (const a of openingAccts ?? []) {
      const r = a as Record<string, unknown>;
      const g = groupFor(String(r.id), String(r.account_kind));
      g.opening = roundMoney(g.opening + (Number(r.opening_balance) || 0));
    }
    // Migration opening_balances rows (kind 'cash') with a real account
    // join that account's opening. Rows with NO account cannot be
    // attributed to an account or kind, so they are honoured only in
    // the all-accounts view, as unattributedOpening (see below) — the
    // write shape carries no account for them, which is reported as a
    // shape gap rather than guessed into a kind.
    const { data: cashEvidence } = await db.from("opening_balances").select("amount, as_of, cash_account_id")
      .eq("balance_kind", "cash");
    let evidenceOpening = 0;
    let unattributedOpening = 0;
    for (const r of cashEvidence ?? []) {
      const row = r as Record<string, unknown>;
      if (String(row.as_of ?? "").slice(0, 10) > toDate) continue;
      const amt = Number(row.amount) || 0;
      const acctId = row.cash_account_id ? String(row.cash_account_id) : null;
      if (acctId && (!input.accountId || input.accountId === acctId)) {
        const acct = labelById.get(acctId);
        if (!acct) continue;
        if (input.accountKind && String(acct.account_kind) !== input.accountKind) continue;
        // Only accounts in this view's opening set carry evidence;
        // an inactive account's evidence is left out with its master
        // opening (matching the previous active-only opening rule).
        const inView = (openingAccts ?? []).some((a) => String((a as Record<string, unknown>).id) === acctId);
        if (!inView) continue;
        const g = groupFor(acctId, String(acct.account_kind));
        g.opening = roundMoney(g.opening + amt);
        evidenceOpening = roundMoney(evidenceOpening + amt);
      } else if (!acctId && !input.accountId && !input.accountKind) {
        unattributedOpening = roundMoney(unattributedOpening + amt);
      }
    }
    // Prior movements (before `from`) belong in each group's opening.
    // DB-side aggregate first (supabase/migration-speed-party-cash-
    // openings.sql): one grouped sum per (cash_account_id, account)
    // pair instead of shipping every pre-period row. The pair grain
    // matters: kind views filter the old scan by the ledger `account`
    // column while grouping by cash_account_id, so the caller re-
    // applies exactly those filters below (kind -> account = kind,
    // accountId -> cash_account_id = id, all -> no filter). The sum
    // is figure-identical to the per-row loop (debit/credit are
    // NUMERIC(15,2), so the exact decimal sum rounded to 2dp equals
    // the old per-row rounded accumulation), and a pair row is
    // emitted even at net 0, so net-zero groups are still created.
    // INTERIM FALLBACK: if the migration was never applied live, the
    // RPC errors and we fall back to the old full scan, which
    // produces identical figures — the app works either way, just
    // slower without the migration. Remove the fallback once the
    // migration is confirmed applied.
    const rpcPrior = await db.rpc("cash_openings", { p_before: input.from });
    if (!rpcPrior.error && Array.isArray(rpcPrior.data)) {
      for (const r of rpcPrior.data as { cash_account_id: string | null; account: string; opening_delta: number }[]) {
        const acctId = r.cash_account_id ? String(r.cash_account_id) : null;
        const acct = String(r.account);
        if (input.accountId && acctId !== input.accountId) continue;
        if (input.accountKind && acct !== input.accountKind) continue;
        const g = groupFor(acctId, acct);
        g.opening = roundMoney(g.opening + (Number(r.opening_delta) || 0));
      }
    } else {
      let priorQ = db.from("cash_ledger").select("debit, credit, cash_account_id, account").lt("date", input.from);
      if (input.accountId) priorQ = priorQ.eq("cash_account_id", input.accountId);
      else if (input.accountKind) priorQ = priorQ.eq("account", input.accountKind);
      const { data: prior } = await priorQ;
      for (const r of prior ?? []) {
        const row = r as Record<string, unknown>;
        const g = groupFor(row.cash_account_id ? String(row.cash_account_id) : null, String(row.account));
        g.opening = roundMoney(g.opening + (Number(row.debit) || 0) - (Number(row.credit) || 0));
      }
    }
    let q = db.from("cash_ledger").select("*")
      .gte("date", input.from).lt("date", toExclusive)
      .order("date", { ascending: true }).order("created_at", { ascending: true });
    if (input.accountId) q = q.eq("cash_account_id", input.accountId);
    else if (input.accountKind) q = q.eq("account", input.accountKind);
    const { data: rows, error: qError } = await q;
    if (qError) return fail(qError.message);
    let receipts = 0;
    let payments = 0;
    let transfersIn = 0;
    let transfersOut = 0;
    const runningByGroup = new Map<string, number>();
    for (const g of groups.values()) runningByGroup.set(g.key, g.opening);
    const entries = (rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const debit = Number(row.debit) || 0;
      const credit = Number(row.credit) || 0;
      receipts = roundMoney(receipts + debit);
      payments = roundMoney(payments + credit);
      if (row.voucher_type === "transfer") {
        transfersIn = roundMoney(transfersIn + debit);
        transfersOut = roundMoney(transfersOut + credit);
      }
      const g = groupFor(row.cash_account_id ? String(row.cash_account_id) : null, String(row.account));
      const running = cashRunningBalance(runningByGroup.get(g.key) ?? g.opening, debit, credit);
      runningByGroup.set(g.key, running);
      return {
        ...row,
        running_balance: running,
        account_balance: running,
        account_label: g.cashAccountId ? `${g.code} — ${g.name}` : g.name,
      };
    });
    const balances = [...groups.values()]
      .filter((g) => groups.has(g.key) && (runningByGroup.has(g.key) || (openingAccts ?? []).some((a) => String((a as Record<string, unknown>).id) === g.cashAccountId)))
      .map((g) => ({
        cashAccountId: g.cashAccountId,
        code: g.code,
        name: g.name,
        accountKind: g.accountKind,
        opening: g.opening,
        closing: runningByGroup.get(g.key) ?? g.opening,
      }));
    const groupOpening = [...groups.values()].reduce((s, g) => roundMoney(s + g.opening), 0);
    const opening = roundMoney(groupOpening + unattributedOpening);
    const closing = daybookClosing(opening, receipts, payments);
    return {
      success: true,
      data: {
        account: accountLabel, from: input.from, to: input.to,
        opening, receipts, payments, transfersIn, transfersOut,
        closing, entries, balances, evidenceOpening, unattributedOpening,
      },
    };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ------------------------------------------------------- party statements

export async function getPartyStatement(input: {
  partyId: string;
  from: string;
  to: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSensitiveRead(db);
  if ("error" in gate) return fail(gate.error);
  try {
    const { data: party } = await db.from("parties").select("*").eq("id", input.partyId).maybeSingle();
    if (!party) return fail("Party not found.");
    const masterOpening = signedPartyOpening(Number(party.opening_balance) || 0, party.balance_type);
    const evidence = await partyEvidenceOpening(db, input.partyId, input.to, party.balance_type);
    const { data: prior } = await db.from("party_ledger").select("debit, credit")
      .eq("party_id", input.partyId).lt("date", input.from);
    let opening = roundMoney(masterOpening + evidence.total);
    for (const r of prior ?? []) {
      opening = roundMoney(opening + (Number(r.debit) || 0) - (Number(r.credit) || 0));
    }
    const { data: rows, error: qError } = await db.from("party_ledger").select("*")
      .eq("party_id", input.partyId)
      .gte("date", input.from).lt("date", exclusiveToBound(input.to))
      .order("date", { ascending: true }).order("created_at", { ascending: true });
    if (qError) return fail(qError.message);
    let charges = 0;
    let settlements = 0;
    let running = opening;
    const entries = (rows ?? []).map((r) => {
      const debit = Number(r.debit) || 0;
      const credit = Number(r.credit) || 0;
      charges = roundMoney(charges + debit);
      settlements = roundMoney(settlements + credit);
      running = roundMoney(running + debit - credit);
      return { ...r, running_balance: running };
    });
    return {
      success: true,
      data: {
        party, from: input.from, to: input.to, opening,
        masterOpening, evidenceOpening: evidence.total,
        charges, settlements, closing: running, entries,
        // Sign convention: closing > 0 = receivable, < 0 = payable.
        closingKind: running > 0 ? "receivable" : running < 0 ? "payable" : "settled",
      },
    };
  } catch (err) {
    return fail(errMsg(err));
  }
}

/** Vendor statement = the same party statement (payable sign convention). */
export async function getVendorStatement(input: {
  partyId: string;
  from: string;
  to: string;
}): Promise<ActionResult> {
  return getPartyStatement(input);
}

/**
 * Party adjustment entry (spec §10/§11): a manual, audited correction
 * to one party's ledger. It writes exactly one party_ledger row with
 * entry_type = 'adjustment' — this exact string is what the reports
 * team's statement rendering keys on — and nothing else: no cash, no
 * stock, no invoice/purchase row is created or changed.
 *
 * Direction is ledger-native: 'debit' increases the receivable balance
 * (delta +amount: the party owes more, or a vendor payable falls by
 * that amount); 'credit' decreases it (delta −amount). Reason is
 * mandatory and stored on the row and in the audit log, so an
 * adjustment is never silent. There is no adjustment header table:
 * voucher_id and voucher_no are the generated ADJ document number.
 */
export async function createPartyAdjustment(input: {
  partyId: string;
  amount: number;
  direction: "debit" | "credit";
  reason: string;
  date?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (!input.partyId) return fail("partyId is required.");
    const amount = pos(input.amount, "amount");
    if (amount === null) return fail("Adjustment amount must be > 0.");
    if (input.direction !== "debit" && input.direction !== "credit") {
      return fail("Adjustment direction must be 'debit' or 'credit'.");
    }
    if (!input.reason?.trim()) return fail("A reason is mandatory for a party adjustment.");
    const { data: party } = await db.from("parties").select("id").eq("id", input.partyId).maybeSingle();
    if (!party) return fail("Party not found.");
    const voucherNo = await nextDocNo(db, "party_adjustment", "ADJ");
    const date = input.date ?? new Date().toISOString();
    const delta = input.direction === "debit" ? amount : -amount;
    await partyEntry(db, {
      partyId: input.partyId, date, entryType: "adjustment",
      voucherType: "adjustment", voucherId: voucherNo, voucherNo,
      delta, notes: `Party adjustment (${input.direction}): ${input.reason.trim()}`,
      userId: gate.actor.userId,
    });
    await logAudit(db, {
      action: "adjustment", entityType: "party_adjustments", entityId: voucherNo,
      voucherNo, after: { party_id: input.partyId, amount, direction: input.direction },
      reason: input.reason.trim(),
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return {
      success: true,
      data: {
        voucherNo, partyId: input.partyId, amount, direction: input.direction,
        delta, entryType: "adjustment", reason: input.reason.trim(), date,
      },
    };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ---------------------------------------------------------------- P&L

/**
 * P&L per spec §15. Revenue is POSTED invoices only — receipts are cash
 * collection and are deliberately never added here. COGS comes from the
 * accountant-supplied approved valuation (cogsAmount); when it is not
 * supplied the report says so and uses 0 rather than silently treating
 * purchases as cost. Packaging cost is consumed-bag cost only.
 */
export async function getPL(input: {
  from: string;
  to: string;
  cogsAmount?: number;
  cogsBasis?: string;
  packagingCostAmount?: number;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSensitiveRead(db);
  if ("error" in gate) return fail(gate.error);
  try {
    const warnings: string[] = [];
    const { data: invoices, error: iError } = await db.from("customer_invoices").select("source_type, total_amount")
      .eq("status", "posted").gte("date", input.from).lt("date", exclusiveToBound(input.to));
    if (iError) return fail(iError.message);
    let serviceRevenue = 0;
    let productSales = 0;
    let otherRevenue = 0;
    for (const inv of invoices ?? []) {
      const amt = Number(inv.total_amount) || 0;
      if (inv.source_type === "machinery_job" || inv.source_type === "packing") serviceRevenue = roundMoney(serviceRevenue + amt);
      else if (inv.source_type === "sale") productSales = roundMoney(productSales + amt);
      else otherRevenue = roundMoney(otherRevenue + amt);
    }
    const { data: expenses } = await db.from("expenses").select("amount, category_name")
      .eq("status", "posted").gte("date", input.from).lt("date", exclusiveToBound(input.to));
    let operatingExpenses = 0;
    for (const e of expenses ?? []) operatingExpenses = roundMoney(operatingExpenses + (Number(e.amount) || 0));
    const { data: payroll } = await db.from("payroll_periods").select("net_payable")
      .in("status", ["approved", "partially_paid", "paid"])
      .gte("period_start", input.from).lt("period_start", exclusiveToBound(input.to));
    let payrollCost = 0;
    for (const p of payroll ?? []) payrollCost = roundMoney(payrollCost + (Number(p.net_payable) || 0));
    // Packaging: consumed-bag cost from genuine consumption rows only.
    // Explicit allow-list (packing / batch_packing): bag PURCHASES are
    // never added here (that would double-count), and neither are
    // purchase returns/reversals — the old "everything except
    // purchase_return" filter wrongly counted purchase reversals as
    // consumption. Any future out-row type is excluded by default.
    let packagingCost: number;
    if (input.packagingCostAmount !== undefined) {
      packagingCost = roundMoney(input.packagingCostAmount);
    } else {
      const { data: consumed } = await db.from("bardana_ledger").select("out_qty, total_cost, voucher_type")
        .gte("date", input.from).lt("date", exclusiveToBound(input.to));
      let cost = 0;
      let bagsOut = 0;
      for (const r of consumed ?? []) {
        if ((Number(r.out_qty) || 0) > 0 && isPackagingConsumptionVoucherType(r.voucher_type)) {
          bagsOut += Number(r.out_qty) || 0;
          cost = roundMoney(cost + (Number(r.total_cost) || 0));
        }
      }
      packagingCost = cost;
      if (bagsOut > 0 && cost === 0) {
        warnings.push("Bardana consumption is recorded but carries no cost — packaging cost shows 0 until consumption rows carry unit_cost or an approved inclusive service-cost model is confirmed (spec §15.1).");
      }
    }
    let cogs = 0;
    let cogsBasis = input.cogsBasis ?? "";
    if (input.cogsAmount !== undefined) {
      cogs = roundMoney(input.cogsAmount);
    } else {
      warnings.push("COGS was not supplied: the accountant's approved inventory valuation is still unconfirmed (spec §15.2 / §19). COGS is shown as 0 — this is NOT a valuation, and purchases in the period were deliberately not used as COGS.");
      cogsBasis = cogsBasis || "UNCONFIRMED — awaiting accountant-approved valuation method";
    }
    const revenue = roundMoney(serviceRevenue + productSales + otherRevenue);
    const totalCost = roundMoney(cogs + packagingCost + operatingExpenses + payrollCost);
    const net = roundMoney(revenue - totalCost);
    return {
      success: true,
      data: {
        from: input.from, to: input.to,
        serviceRevenue, productSalesRevenue: productSales, otherRevenue, revenue,
        cogs, cogsBasis, packagingCost, operatingExpenses, payrollCost,
        totalCost, netProfit: net, warnings,
      },
    };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ---------------------------------------------------------------- COGS approvals & stock valuation

/**
 * COGS approvals (spec §15.2): COGS stays accountant-supplied, never
 * computed from purchases or any invented method. The accountant
 * records one approved COGS figure per calendar period in
 * pl_cogs_approvals (see supabase/migration-finance-cogs-approvals.sql);
 * the reports team reads it back with getCogsApproval and passes it to
 * getPL as cogsAmount. Saving again for the same period REPLACES the
 * earlier approval (one approval per period) and is audited; the old
 * row is updated, not duplicated.
 */
export async function saveCogsApproval(input: {
  month: number;
  year: number;
  amount: number;
  basis?: string;
  note?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    const month = Number(input.month);
    const year = Number(input.year);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return fail("COGS approval month must be 1–12.");
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return fail("COGS approval year must be a four-digit year.");
    }
    const amount = nonNeg(input.amount, "amount");
    if (amount === null) return fail("COGS approval amount must be >= 0.");
    const row = {
      period_month: month,
      period_year: year,
      amount,
      basis: input.basis?.trim() || null,
      note: input.note?.trim() || null,
      approved_by: gate.actor.userId,
    };
    const { data: existing } = await db.from("pl_cogs_approvals").select("id")
      .eq("period_year", year).eq("period_month", month).maybeSingle();
    let data;
    if (existing) {
      const { data: updated, error: uError } = await db.from("pl_cogs_approvals")
        .update(row).eq("id", (existing as Record<string, unknown>).id).select().single();
      if (uError) return fail(uError.message);
      data = updated;
    } else {
      const { data: inserted, error: iError } = await db.from("pl_cogs_approvals")
        .insert(row).select().single();
      if (iError) return fail(iError.message);
      data = inserted;
    }
    await logAudit(db, {
      action: "approve", entityType: "pl_cogs_approvals", entityId: (data as Record<string, unknown>).id as string,
      after: { period_month: month, period_year: year, amount, basis: row.basis },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data };
  } catch (err) {
    return fail(errMsg(err));
  }
}

/** Read back the approved COGS for one period; data is null when none exists. */
export async function getCogsApproval(input: {
  month: number;
  year: number;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSensitiveRead(db);
  if ("error" in gate) return fail(gate.error);
  const { data, error: qError } = await db.from("pl_cogs_approvals").select("*")
    .eq("period_year", Number(input.year)).eq("period_month", Number(input.month))
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (qError) return fail(qError.message);
  return { success: true, data: data ?? null };
}

/**
 * Stock valuation (reports team renders it). Method comes from the
 * caller — in practice the accountant-confirmed value in the
 * app_settings pl_config key — and is NEVER hard-coded here.
 *
 * - last_purchase_cost: each product's closing stock (stock_ledger
 *   inward − outward) × its latest posted, received purchase price.
 * - average_cost: closing stock × quantity-weighted average of all its
 *   posted, received purchase prices (Σ qty×price / Σ qty).
 * - "unconfirmed" (or anything else): { status: "method_not_set",
 *   totalValue: null } — never a number, never a guess.
 * Products with stock but no purchase history are listed in
 * uncostedProductIds with value null, never valued at 0.
 * Cost-ledger WRITES into batch/job posting are NOT done here — that
 * is wave-2 work; this action only reads purchase history and the
 * stock ledger.
 */
export async function getStockValuation(
  method: "last_purchase_cost" | "average_cost" | "unconfirmed" | string,
): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSensitiveRead(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (method !== "last_purchase_cost" && method !== "average_cost") {
      const result = computeStockValuation([], [], method ?? "unconfirmed");
      return { success: true, data: result };
    }
    const { data: ledger, error: lError } = await db.from("stock_ledger")
      .select("product_id, inward_qty, outward_qty");
    if (lError) return fail(lError.message);
    const closingByProduct = new Map<string, number>();
    for (const r of ledger ?? []) {
      const pid = String((r as Record<string, unknown>).product_id);
      const qty = (Number((r as Record<string, unknown>).inward_qty) || 0)
        - (Number((r as Record<string, unknown>).outward_qty) || 0);
      closingByProduct.set(pid, roundMoney((closingByProduct.get(pid) ?? 0) + qty));
    }
    const products = [...closingByProduct.entries()].map(([productId, closingQty]) => ({
      productId, closingQty,
    }));
    // Posted, received purchases only: bill-only purchases never moved
    // stock, so their prices must not price stock on hand.
    const { data: postedPurchases, error: pError } = await db.from("purchases")
      .select("id, date").eq("status", "posted").eq("receipt_status", "received");
    if (pError) return fail(pError.message);
    const postedIds = new Set((postedPurchases ?? []).map((p) => String((p as Record<string, unknown>).id)));
    const dateById = new Map((postedPurchases ?? []).map((p) => [
      String((p as Record<string, unknown>).id),
      String((p as Record<string, unknown>).date ?? ""),
    ]));
    const { data: lines, error: liError } = await db.from("purchase_items")
      .select("purchase_id, product_id, quantity, unit_price").eq("item_type", "seed");
    if (liError) return fail(liError.message);
    const purchases = (lines ?? [])
      .filter((l) => postedIds.has(String((l as Record<string, unknown>).purchase_id))
        && (l as Record<string, unknown>).product_id)
      .map((l) => {
        const row = l as Record<string, unknown>;
        return {
          productId: String(row.product_id),
          quantity: Number(row.quantity) || 0,
          unitPrice: Number(row.unit_price) || 0,
          date: dateById.get(String(row.purchase_id)) ?? "",
        };
      });
    const result = computeStockValuation(products, purchases, method);
    return { success: true, data: result };
  } catch (err) {
    return fail(errMsg(err));
  }
}

// ---------------------------------------------------------------- bardana & openings

/**
 * Bardana ledger + report totals. In addition to the ledger entries and
 * the purchased/consumed/returned counts, this returns:
 * - opening: bags evidenced by opening_balances rows (kind 'bardana',
 *   matching the packaging/godown filter) dated before `from` when a
 *   `from` is given, else on/before `to` (else all). Reported
 *   SEPARATELY: it is NOT added to `closing`, which is the last
 *   ledger running_balance — whether the ledger was seeded from the
 *   opening evidence cannot be told from the ledger alone, and adding
 *   both blindly would double-count. Callers must not add them either.
 * - damaged: bags on posted packing_records in the same range and
 *   packaging filter. Damaged bags are tracked on packing records,
 *   not the bardana ledger (ledger consumption rows fold packed +
 *   damaged together); reversed packing records are excluded via
 *   status = 'posted'. packing_records carry no godown, so a godown
 *   filter does not narrow damaged.
 * - valuation: bardanaValuation over the returned entries — the sum of
 *   recorded total_cost values only, with its label saying so. It is
 *   NOT a closing-stock valuation under any costing method.
 * The `to` day is inclusive via an exclusive next-day bound (the old
 * plain `.lte("date", to)` dropped the whole `to` day).
 */
export async function getBardanaLedger(input: {
  packagingTypeId?: string;
  godownId?: string;
  from?: string;
  to?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  let q = db.from("bardana_ledger").select("*").order("date", { ascending: true }).order("created_at", { ascending: true });
  if (input.packagingTypeId) q = q.eq("packaging_type_id", input.packagingTypeId);
  if (input.godownId) q = q.eq("godown_id", input.godownId);
  if (input.from) q = q.gte("date", input.from);
  if (input.to) {
    q = isPlainDate(input.to)
      ? q.lt("date", exclusiveNextDay(input.to))
      : q.lte("date", input.to);
  }
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  let purchased = 0;
  let consumed = 0;
  let returned = 0;
  for (const r of data ?? []) {
    if (r.voucher_type === "purchase") purchased += Number(r.in_qty) || 0;
    else if (r.voucher_type === "purchase_return") returned += Number(r.out_qty) || 0;
    else consumed += Number(r.out_qty) || 0;
  }
  const closing = data?.length ? Number(data[data.length - 1].running_balance) || 0 : 0;
  const valuation = bardanaValuation((data ?? []).map((r) => ({
    in_qty: Number(r.in_qty) || 0,
    out_qty: Number(r.out_qty) || 0,
    total_cost: Number(r.total_cost) || 0,
  })));
  // Opening evidence (see header comment): as_of is a DATE column, so
  // plain-date comparisons are exact here — no next-day bound needed.
  let openingQ = db.from("opening_balances").select("quantity, as_of, packaging_type_id, godown_id")
    .eq("balance_kind", "bardana");
  if (input.packagingTypeId) openingQ = openingQ.eq("packaging_type_id", input.packagingTypeId);
  if (input.godownId) openingQ = openingQ.eq("godown_id", input.godownId);
  const { data: openingRows } = await openingQ;
  let opening = 0;
  for (const r of openingRows ?? []) {
    const asOf = String((r as Record<string, unknown>).as_of ?? "").slice(0, 10);
    if (input.from && asOf >= input.from.slice(0, 10)) continue;
    if (!input.from && input.to && asOf > input.to.slice(0, 10)) continue;
    opening += Number((r as Record<string, unknown>).quantity) || 0;
  }
  // Damaged bags from posted packing records in the same range/filter.
  // packing_records carry no godown column, so a godown filter cannot
  // narrow damaged — it is documented here rather than faked with a
  // filter on a column that does not exist.
  let damagedQ = db.from("packing_records").select("damaged_bags, date, packaging_type_id")
    .eq("status", "posted");
  if (input.packagingTypeId) damagedQ = damagedQ.eq("packaging_type_id", input.packagingTypeId);
  if (input.from) damagedQ = damagedQ.gte("date", input.from);
  if (input.to) {
    damagedQ = isPlainDate(input.to)
      ? damagedQ.lt("date", exclusiveNextDay(input.to))
      : damagedQ.lte("date", input.to);
  }
  const { data: damagedRows } = await damagedQ;
  let damaged = 0;
  for (const r of damagedRows ?? []) damaged += Number((r as Record<string, unknown>).damaged_bags) || 0;
  return {
    success: true,
    data: { entries: data, purchased, consumed, returned, closing, opening, damaged, valuation },
  };
}

export async function createOpeningBalance(input: {
  balanceKind: "cash" | "party" | "stock" | "bardana" | "payroll";
  entityKey: string;
  partyId?: string | null;
  cashAccountId?: string | null;
  productId?: string | null;
  packagingTypeId?: string | null;
  godownId?: string | null;
  employeeId?: string | null;
  amount?: number;
  quantity?: number;
  asOf?: string;
  sourceNote?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!input.entityKey?.trim()) return fail("entityKey is required (e.g. 'party:<uuid>').");
  const { data, error: iError } = await db
    .from("opening_balances")
    .insert({
      balance_kind: input.balanceKind, entity_key: input.entityKey.trim(),
      party_id: input.partyId ?? null, cash_account_id: input.cashAccountId ?? null,
      product_id: input.productId ?? null, packaging_type_id: input.packagingTypeId ?? null,
      godown_id: input.godownId ?? null, employee_id: input.employeeId ?? null,
      amount: roundMoney(input.amount ?? 0), quantity: roundMoney(input.quantity ?? 0),
      as_of: input.asOf ?? new Date().toISOString().slice(0, 10),
      source_note: input.sourceNote ?? null, approved_by: gate.actor.userId,
      created_by: gate.actor.userId,
    })
    .select()
    .single();
  if (iError) return fail(iError.message);
  await logAudit(db, {
    action: "create", entityType: "opening_balances", entityId: data.id,
    after: { balance_kind: input.balanceKind, entity_key: input.entityKey, amount: input.amount ?? 0 },
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data };
}

export async function listOpeningBalances(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  const { data, error: qError } = await db.from("opening_balances").select("*").order("created_at", { ascending: false });
  if (qError) return fail(qError.message);
  return { success: true, data };
}

// Keep AppRole import used for future allow-list extension points.
export type { AppRole };

/** Unified init data for /purchases page — replaces 6 client roundtrips with 1 */
export async function getPurchasesInitData(filters: {
  page?: number;
  pageSize?: number;
  vendorId?: string;
  status?: string;
  from?: string;
  to?: string;
} = {}): Promise<ActionResult<{
  purchases: unknown;
  parties: unknown[];
  godowns: unknown[];
  products: unknown[];
  returns: unknown[];
  cashAccounts: unknown[];
}>> {
  try {
    const [pu, pa, g, pr, re, ca] = await Promise.all([
      listPurchases(filters),
      listParties(),
      listGodowns(),
      listProducts(),
      listPurchaseReturns(),
      listCashAccounts(),
    ]);
    return ok({
      purchases: pu.data,
      parties: (Array.isArray(pa.data) ? pa.data : []) as any[],
      godowns: (Array.isArray(g.data) ? g.data : []) as any[],
      products: (Array.isArray(pr.data) ? pr.data : []) as any[],
      returns: (Array.isArray(re.data) ? re.data : []) as any[],
      cashAccounts: (Array.isArray(ca.data) ? ca.data : []) as any[],
    });
  } catch (e) {
    return fail(errMsg(e));
  }
}

/** Unified init data for /daybook page — replaces 8 client roundtrips with 1 */
export async function getDaybookInitData(filters: {
  from: string;
  to: string;
  expensePage?: number;
  expensePageSize?: number;
}): Promise<ActionResult<{
  cash: unknown;
  bank: unknown;
  online: unknown;
  all: unknown;
  expenses: unknown;
  cashAccounts: unknown[];
  parties: unknown[];
  expenseCategories: unknown[];
}>> {
  try {
    const [cash, bank, online, all, ex, ca, pa, ec] = await Promise.all([
      getDaybook({ accountKind: "cash", from: filters.from, to: filters.to }),
      getDaybook({ accountKind: "bank", from: filters.from, to: filters.to }),
      getDaybook({ accountKind: "online", from: filters.from, to: filters.to }),
      getDaybook({ from: filters.from, to: filters.to }),
      listExpenses({ page: filters.expensePage ?? 1, pageSize: filters.expensePageSize ?? 50 }),
      listCashAccounts(),
      listParties(),
      listExpenseCategories(),
    ]);
    return ok({
      cash: cash.data,
      bank: bank.data,
      online: online.data,
      all: all.data,
      expenses: ex.data,
      cashAccounts: (Array.isArray(ca.data) ? ca.data : []) as any[],
      parties: (Array.isArray(pa.data) ? pa.data : []) as any[],
      expenseCategories: (Array.isArray(ec.data) ? ec.data : []) as any[],
    });
  } catch (e) {
    return fail(errMsg(e));
  }
}

/** Unified init data for /billing page — replaces 4 client roundtrips with 1 */
export async function getBillingInitData(filters: {
  receiptPage?: number;
  invoicePage?: number;
  pageSize?: number;
} = {}): Promise<ActionResult<{
  receipts: unknown;
  invoices: unknown;
  parties: unknown[];
  cashAccounts: unknown[];
}>> {
  try {
    const pageSize = filters.pageSize ?? 50;
    const [re, inv, pa, ca] = await Promise.all([
      listReceipts({ page: filters.receiptPage ?? 1, pageSize }),
      listInvoices({ page: filters.invoicePage ?? 1, pageSize }),
      listParties(),
      listCashAccounts(),
    ]);
    return ok({
      receipts: re.data,
      invoices: inv.data,
      parties: (Array.isArray(pa.data) ? pa.data : []) as any[],
      cashAccounts: (Array.isArray(ca.data) ? ca.data : []) as any[],
    });
  } catch (e) {
    return fail(errMsg(e));
  }
}
