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
import {
  roundMoney,
  cashRunningBalance,
  daybookClosing,
  ledgerRunningBalance,
} from "@/lib/calc";

type Db = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

// ---------------------------------------------------------------- helpers

function fail(error: string): ActionResult {
  return { success: false, error };
}

function genNo(prefix: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${prefix}-${ymd}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
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
  });
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
    created_by: input.userId ?? null,
  });
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
  });
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
  });
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

function dateRange(q: {
  from?: string;
  to?: string;
  column?: string;
}, builder: {
  gte: (col: string, v: string) => typeof builder;
  lte: (col: string, v: string) => typeof builder;
}): typeof builder {
  const col = q.column ?? "date";
  let b = builder;
  if (q.from) b = b.gte(col, q.from);
  if (q.to) b = b.lte(col, q.to);
  return b;
}

// ---------------------------------------------------------------- cash accounts

export async function listCashAccounts(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  const { data, error: qError } = await db
    .from("cash_accounts")
    .select("*")
    .order("code", { ascending: true });
  if (qError) return fail(qError.message);
  return { success: true, data };
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
  await logAudit(db, {
    action: "create", entityType: "cash_accounts", entityId: data.id,
    after: { code: input.code, opening_balance: opening },
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data };
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
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
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
        purchase_no: genNo("PUR"),
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
      for (const item of items ?? []) {
        if (item.item_type === "seed") {
          if (!purchase.godown_id) return fail("A godown is required to receive seed stock.");
          await stockEntry(db, {
            date: purchase.date, voucherType: "purchase", voucherId: purchase.id,
            voucherNo: purchase.purchase_no, godownId: purchase.godown_id,
            productId: item.product_id, partyId: purchase.vendor_id,
            inwardQty: Number(item.quantity) || 0, outwardQty: 0,
            notes: "Purchase receipt", userId: gate.actor.userId,
          });
        } else {
          const bags = Number(item.bags_count) || Math.round(Number(item.quantity) || 0);
          await bardanaEntry(db, {
            date: purchase.date, voucherType: "purchase", voucherId: purchase.id,
            voucherNo: purchase.purchase_no, packagingTypeId: item.packaging_type_id,
            godownId: purchase.godown_id, inQty: bags, outQty: 0,
            unitCost: Number(item.unit_price) || null,
            notes: "Bardana purchase", userId: gate.actor.userId,
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
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) {
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
    const { data: items } = await db.from("purchase_items").select("*").eq("purchase_id", id);
    if (purchase.receipt_status === "received") {
      for (const item of items ?? []) {
        if (item.item_type === "seed" && purchase.godown_id) {
          await stockEntry(db, {
            date: new Date().toISOString(), voucherType: "purchase_reversal",
            voucherId: purchase.id, voucherNo: `${purchase.purchase_no}-R`,
            godownId: purchase.godown_id, productId: item.product_id,
            partyId: purchase.vendor_id, inwardQty: 0,
            outwardQty: Number(item.quantity) || 0,
            notes: `Reversal: ${reason}`, userId: gate.actor.userId,
          });
        } else if (item.item_type === "packaging") {
          const bags = Number(item.bags_count) || Math.round(Number(item.quantity) || 0);
          await bardanaEntry(db, {
            date: new Date().toISOString(), voucherType: "purchase_reversal",
            voucherId: purchase.id, voucherNo: `${purchase.purchase_no}-R`,
            packagingTypeId: item.packaging_type_id, godownId: purchase.godown_id,
            inQty: 0, outQty: bags, notes: `Reversal: ${reason}`, userId: gate.actor.userId,
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
      .update({ status: "reversed", reversal_reason: reason, balance_amount: 0 })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) return fail("Purchase could not be reversed (concurrent change?).");
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
      return fail("Returns link to a posted original purchase.");
    }
    const lines = [];
    let total = 0;
    for (const item of input.items) {
      const qty = nonNeg(item.quantity, "quantity");
      const price = nonNeg(item.unitPrice, "unitPrice");
      if (qty === null || price === null) return fail("Return quantities and prices must be >= 0.");
      const lineTotal = roundMoney(qty * price);
      total = roundMoney(total + lineTotal);
      lines.push({ purchase_item_id: item.purchaseItemId, quantity: qty, unit_price: price, line_total: lineTotal });
    }
    const { data, error: iError } = await db
      .from("purchase_returns")
      .insert({
        return_no: genNo("PRT"), purchase_id: input.purchaseId,
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
    const { data: lines } = await db.from("purchase_return_items").select("*").eq("return_id", id);
    if (purchase.receipt_status === "received") {
      for (const line of lines ?? []) {
        const { data: orig } = await db.from("purchase_items").select("*").eq("id", line.purchase_item_id).maybeSingle();
        if (!orig) continue;
        if (orig.item_type === "seed" && purchase.godown_id) {
          await stockEntry(db, {
            date: ret.date, voucherType: "purchase_return", voucherId: ret.id,
            voucherNo: ret.return_no, godownId: purchase.godown_id,
            productId: orig.product_id, partyId: purchase.vendor_id,
            inwardQty: 0, outwardQty: Number(line.quantity) || 0,
            notes: `Return against ${purchase.purchase_no}`, userId: gate.actor.userId,
          });
        } else if (orig.item_type === "packaging") {
          await bardanaEntry(db, {
            date: ret.date, voucherType: "purchase_return", voucherId: ret.id,
            voucherNo: ret.return_no, packagingTypeId: orig.packaging_type_id,
            godownId: purchase.godown_id, inQty: 0,
            outQty: Math.round(Number(line.quantity) || 0),
            notes: `Return against ${purchase.purchase_no}`, userId: gate.actor.userId,
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
    if (uError || !updated) return fail("Return could not be posted (concurrent change?).");
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
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  // Header columns only: no caller reads invoice_lines from this list
  // (billing renders headers and balances; receipt print builds its own
  // allocations), so shipping every line with every invoice was pure
  // payload on every billing load.
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
        invoice_no: genNo("INV"), date: input.date ?? new Date().toISOString(),
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
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) return fail("Invoice could not be posted (concurrent change?).");
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
      .update({ status: "reversed", reversal_reason: reason, balance_amount: 0 })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) return fail("Invoice could not be reversed (concurrent change?).");
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
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
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
        receipt_no: genNo("RCT"), date: input.date ?? new Date().toISOString(),
        customer_id: input.customerId, cash_account_id: input.cashAccountId ?? null,
        account: input.account, payment_method: input.paymentMethod ?? "cash",
        amount, unapplied_amount: roundMoney(amount - allocated),
        reference_no: input.referenceNo ?? null, notes: input.notes ?? null,
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
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) return fail("Receipt could not be posted (concurrent change?).");
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
      .update({ status: "reversed", reversal_reason: reason })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) return fail("Receipt could not be reversed (concurrent change?).");
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
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
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
    let allocated = 0;
    for (const a of input.allocations ?? []) {
      const amt = pos(a.amount, "allocation amount");
      if (amt === null) return fail("Each allocation amount must be > 0.");
      allocated = roundMoney(allocated + amt);
    }
    if (allocated > amount) return fail(`Allocations (${allocated}) exceed the payment amount (${amount}).`);
    // Validate targets before moving any money.
    for (const a of input.allocations ?? []) {
      if (a.targetType === "purchase") {
        const { data: pur } = await db.from("purchases").select("*").eq("id", a.targetId).maybeSingle();
        if (!pur || pur.status !== "posted") return fail(`Purchase ${a.targetId} is not posted.`);
        if (Number(a.amount) > Number(pur.balance_amount)) return fail(`Allocation exceeds purchase ${pur.purchase_no} balance.`);
      } else if (a.targetType === "expense") {
        const { data: exp } = await db.from("expenses").select("*").eq("id", a.targetId).maybeSingle();
        if (!exp || exp.status !== "posted" || exp.settlement !== "credit") return fail(`Expense ${a.targetId} is not a posted credit expense.`);
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
        payment_no: genNo("PAY"), date: input.date ?? new Date().toISOString(),
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
    if (input.allocations?.length) {
      const { error: aError } = await db.from("payment_allocations").insert(
        input.allocations.map((a) => ({
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
    for (const a of input.allocations ?? []) {
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
      .update({ status: "reversed", reversal_reason: reason })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) return fail("Payment could not be reversed (concurrent change?).");
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
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireSignedIn(db);
  if (!gate.ok) return fail(gate.error);
  let q = db.from("expenses").select("*").order("date", { ascending: false });
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.categoryName) q = q.eq("category_name", filters.categoryName);
  q = dateRange(filters, q as never) as typeof q;
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
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
    const { data, error: iError } = await db
      .from("expenses")
      .insert({
        expense_no: genNo("EXP"), date: input.date ?? new Date().toISOString(),
        category_name: input.categoryName.trim(), category_id: input.categoryId ?? null,
        payee: input.payee.trim(), vendor_id: input.vendorId ?? null,
        amount, payment_method: input.paymentMethod ?? "cash",
        cash_account_id: input.cashAccountId ?? null, settlement,
        paid_amount: 0, balance_amount: amount,
        description: input.description ?? null, status: "draft",
        client_token: input.clientToken ?? null, created_by: gate.actor.userId,
      })
      .select()
      .single();
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
    if (exp.settlement === "paid") {
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
        status: "posted", posted_at: new Date().toISOString(),
        paid_amount: paid,
        balance_amount: roundMoney(Number(exp.amount) - paid),
      })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError || !updated) return fail("Expense could not be posted (concurrent change?).");
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
      .update({ status: "reversed", reversal_reason: reason, balance_amount: 0 })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError || !updated) return fail("Expense could not be reversed (concurrent change?).");
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
    const transferNo = genNo("TRF");
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
      description: `Transfer out to ${to.name}`, settlementKind: "transfer",
      userId: gate.actor.userId,
    });
    await cashEntry(db, {
      date, voucherType: "transfer", voucherId: data.id, voucherNo: transferNo,
      account: to.account_kind, cashAccountId: to.id, debit: amount, credit: 0,
      description: `Transfer in from ${from.name}`, settlementKind: "transfer",
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
    let opening = 0;
    let accountLabel = input.accountKind ?? "all accounts";
    if (input.accountId) {
      // Independent reads: the account row and its prior ledger rows do not
      // depend on each other, so fetch them together (was sequential).
      const [{ data: acct }, { data: prior }] = await Promise.all([
        db.from("cash_accounts").select("*").eq("id", input.accountId).maybeSingle(),
        db.from("cash_ledger").select("debit, credit")
          .eq("cash_account_id", input.accountId).lt("date", input.from),
      ]);
      if (!acct) return fail("Cash account not found.");
      accountLabel = `${acct.code} — ${acct.name}`;
      opening = roundMoney(Number(acct.opening_balance) || 0);
      for (const r of prior ?? []) {
        opening = roundMoney(opening + (Number(r.debit) || 0) - (Number(r.credit) || 0));
      }
    } else if (input.accountKind) {
      const [{ data: accts }, { data: prior }] = await Promise.all([
        db.from("cash_accounts").select("opening_balance")
          .eq("account_kind", input.accountKind).eq("is_active", true),
        db.from("cash_ledger").select("debit, credit")
          .eq("account", input.accountKind).lt("date", input.from),
      ]);
      for (const a of accts ?? []) opening = roundMoney(opening + (Number(a.opening_balance) || 0));
      for (const r of prior ?? []) {
        opening = roundMoney(opening + (Number(r.debit) || 0) - (Number(r.credit) || 0));
      }
    } else {
      const [{ data: accts }, { data: prior }] = await Promise.all([
        db.from("cash_accounts").select("opening_balance").eq("is_active", true),
        db.from("cash_ledger").select("debit, credit").lt("date", input.from),
      ]);
      for (const a of accts ?? []) opening = roundMoney(opening + (Number(a.opening_balance) || 0));
      for (const r of prior ?? []) {
        opening = roundMoney(opening + (Number(r.debit) || 0) - (Number(r.credit) || 0));
      }
    }
    let q = db.from("cash_ledger").select("*")
      .gte("date", input.from).lte("date", input.to)
      .order("date", { ascending: true }).order("created_at", { ascending: true });
    if (input.accountId) q = q.eq("cash_account_id", input.accountId);
    else if (input.accountKind) q = q.eq("account", input.accountKind);
    const { data: rows, error: qError } = await q;
    if (qError) return fail(qError.message);
    let receipts = 0;
    let payments = 0;
    let transfersIn = 0;
    let transfersOut = 0;
    let running = opening;
    const entries = (rows ?? []).map((r) => {
      const debit = Number(r.debit) || 0;
      const credit = Number(r.credit) || 0;
      receipts = roundMoney(receipts + debit);
      payments = roundMoney(payments + credit);
      if (r.voucher_type === "transfer") {
        transfersIn = roundMoney(transfersIn + debit);
        transfersOut = roundMoney(transfersOut + credit);
      }
      running = cashRunningBalance(running, debit, credit);
      return { ...r, running_balance: running };
    });
    const closing = daybookClosing(opening, receipts, payments);
    return {
      success: true,
      data: {
        account: accountLabel, from: input.from, to: input.to,
        opening, receipts, payments, transfersIn, transfersOut,
        closing, entries,
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
    const signedOpening = party.balance_type === "payable"
      ? -roundMoney(Number(party.opening_balance) || 0)
      : roundMoney(Number(party.opening_balance) || 0);
    const { data: prior } = await db.from("party_ledger").select("debit, credit")
      .eq("party_id", input.partyId).lt("date", input.from);
    let opening = signedOpening;
    for (const r of prior ?? []) {
      opening = roundMoney(opening + (Number(r.debit) || 0) - (Number(r.credit) || 0));
    }
    const { data: rows, error: qError } = await db.from("party_ledger").select("*")
      .eq("party_id", input.partyId)
      .gte("date", input.from).lte("date", input.to)
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
      .eq("status", "posted").gte("date", input.from).lte("date", input.to);
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
      .eq("status", "posted").gte("date", input.from).lte("date", input.to);
    let operatingExpenses = 0;
    for (const e of expenses ?? []) operatingExpenses = roundMoney(operatingExpenses + (Number(e.amount) || 0));
    const { data: payroll } = await db.from("payroll_periods").select("net_payable")
      .in("status", ["approved", "partially_paid", "paid"])
      .gte("period_start", input.from).lte("period_start", input.to);
    let payrollCost = 0;
    for (const p of payroll ?? []) payrollCost = roundMoney(payrollCost + (Number(p.net_payable) || 0));
    // Packaging: consumed-bag cost from bardana consumption rows only.
    // Bag PURCHASES are never added here (that would double-count).
    let packagingCost: number;
    if (input.packagingCostAmount !== undefined) {
      packagingCost = roundMoney(input.packagingCostAmount);
    } else {
      const { data: consumed } = await db.from("bardana_ledger").select("out_qty, total_cost, voucher_type")
        .gte("date", input.from).lte("date", input.to);
      let cost = 0;
      let bagsOut = 0;
      for (const r of consumed ?? []) {
        if ((Number(r.out_qty) || 0) > 0 && r.voucher_type !== "purchase_return") {
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

// ---------------------------------------------------------------- bardana & openings

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
  if (input.to) q = q.lte("date", input.to);
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
  return { success: true, data: { entries: data, purchased, consumed, returned, closing } };
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
