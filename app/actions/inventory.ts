"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { roundWeight, ledgerRunningBalance, stockBalanceFromRows } from "@/lib/calc";

/**
 * Inventory server actions: ledger-derived stock summary, transfers and
 * adjustments.
 *
 * Single-ledger rule: stock balances are COMPUTED from stock_ledger rows
 * (getStockSummary aggregates them). Nothing here writes a balance total
 * directly — every movement is a ledger row, and every ledger row carries
 * voucher_type / voucher_no / voucher_id + created_by + timestamp.
 *
 * Transfers move stock between godowns without changing total enterprise
 * stock (same quantity out of one godown, into the other, same product
 * and same owner party). A product transformation is NOT a transfer —
 * that is a production batch (see production.ts).
 *
 * Adjustments require reason + approver + before/after quantities, and
 * the "before" quantity is verified against the live ledger balance both
 * at creation and at posting; a mismatch fails instead of silently
 * overwriting history.
 */

type Db = Awaited<ReturnType<typeof createClient>>;
type ActionResult = { success: boolean; data?: unknown; error?: string };

function ok(data: unknown): ActionResult {
  return { success: true, data };
}
function fail(error: string): ActionResult {
  return { success: false, error };
}
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function revalidateInventory(): void {
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

async function createdBy(supabase: Db): Promise<string> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? "operator-admin";
  } catch {
    return "operator-admin";
  }
}

async function nextDocNumber(supabase: Db, series: string, prefix: string): Promise<string> {
  const rpc = await supabase.rpc("next_doc_number", { p_series: series, p_prefix: prefix });
  if (!rpc.error && typeof rpc.data === "string" && rpc.data) return rpc.data;
  const existing = await supabase.from("doc_numbering").select("*").eq("series", series).single();
  if (!existing.error && existing.data) {
    const next = Number(existing.data.last_no ?? 0) + 1;
    const updated = await supabase
      .from("doc_numbering")
      .update({ last_no: next })
      .eq("series", series)
      .select()
      .single();
    if (!updated.error) {
      const pfx = (existing.data.prefix as string) || prefix;
      return `${pfx}-${String(next).padStart(6, "0")}`;
    }
  } else {
    await supabase.from("doc_numbering").insert({ series, prefix, last_no: 1 });
    return `${prefix}-000001`;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

async function checkIdempotency(supabase: Db, scope: string, clientToken?: string): Promise<ActionResult | null> {
  if (!clientToken) return null;
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("result")
    .eq("client_token", clientToken)
    .eq("scope", scope)
    .single();
  if (!error && data) return { success: true, data: data.result };
  return null;
}

async function storeIdempotency(
  supabase: Db,
  scope: string,
  clientToken: string | undefined,
  voucherType: string,
  voucherId: string,
  voucherNo: string,
  result: unknown,
): Promise<void> {
  if (!clientToken) return;
  await supabase.from("idempotency_keys").upsert(
    { client_token: clientToken, scope, voucher_type: voucherType, voucher_id: voucherId, voucher_no: voucherNo, result },
    { onConflict: "client_token" },
  );
}

async function stockBalance(
  supabase: Db,
  godownId: string,
  productId: string,
  partyId: string | null,
): Promise<number> {
  let query = supabase
    .from("stock_ledger")
    .select("inward_qty, outward_qty")
    .eq("godown_id", godownId)
    .eq("product_id", productId);
  if (partyId) query = query.eq("party_id", partyId);
  else query = query.is("party_id", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return stockBalanceFromRows((data ?? []) as { inward_qty: number; outward_qty: number }[]);
}

async function appendLedger(
  supabase: Db,
  row: {
    voucher_type: string;
    voucher_id: string;
    voucher_no: string;
    godown_id: string;
    product_id: string;
    party_id: string | null;
    inward_qty: number;
    outward_qty: number;
    notes?: string;
  },
  by: string,
): Promise<void> {
  const prev = await stockBalance(supabase, row.godown_id, row.product_id, row.party_id);
  const running = ledgerRunningBalance(prev, row.inward_qty, row.outward_qty);
  const { error } = await supabase.from("stock_ledger").insert({
    voucher_type: row.voucher_type,
    voucher_id: row.voucher_id,
    voucher_no: row.voucher_no,
    godown_id: row.godown_id,
    product_id: row.product_id,
    party_id: row.party_id,
    inward_qty: row.inward_qty,
    outward_qty: row.outward_qty,
    unit: "kg",
    running_balance: running,
    notes: row.notes ?? null,
    created_by: by,
  });
  if (error) throw new Error(error.message);
}

// ---------------- Reads ----------------
/** Balances computed from stock_ledger rows, grouped by godown x product x owner party. */
export async function getStockSummary(): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const [ledger, godowns, products, parties] = await Promise.all([
      supabase.from("stock_ledger").select("godown_id, product_id, party_id, inward_qty, outward_qty"),
      supabase.from("godowns").select("id, name"),
      supabase.from("products").select("id, name, min_stock"),
      supabase.from("parties").select("id, name"),
    ]);
    if (ledger.error) return fail(ledger.error.message);
    const godownName = new Map((godowns.data ?? []).map((g: { id: string; name: string }) => [g.id, g.name]));
    const productInfo = new Map(
      (products.data ?? []).map((p: { id: string; name: string; min_stock: number }) => [p.id, p]),
    );
    const partyName = new Map((parties.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
    const byKey = new Map<
      string,
      { godown_id: string; product_id: string; party_id: string | null; balance: number }
    >();
    for (const row of (ledger.data ?? []) as {
      godown_id: string;
      product_id: string;
      party_id: string | null;
      inward_qty: number;
      outward_qty: number;
    }[]) {
      const key = `${row.godown_id}|${row.product_id}|${row.party_id ?? ""}`;
      const entry = byKey.get(key) ?? {
        godown_id: row.godown_id,
        product_id: row.product_id,
        party_id: row.party_id,
        balance: 0,
      };
      entry.balance = roundWeight(entry.balance + row.inward_qty - row.outward_qty);
      byKey.set(key, entry);
    }
    const summary = [...byKey.values()].map((e) => {
      const minStock = productInfo.get(e.product_id)?.min_stock ?? 0;
      return {
        godown_id: e.godown_id,
        godown_name: godownName.get(e.godown_id) ?? e.godown_id,
        product_id: e.product_id,
        product_name: productInfo.get(e.product_id)?.name ?? e.product_id,
        // null party = company-owned stock with no recorded owner; a
        // party_id = stock held for / owned by that party.
        party_id: e.party_id,
        party_name: e.party_id ? (partyName.get(e.party_id) ?? e.party_id) : null,
        balance_kg: e.balance,
        unit: "kg",
        min_stock_kg: minStock,
        below_min_stock: e.balance < minStock,
      };
    });
    return ok(summary);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function getStockLedger(filters?: {
  godownId?: string;
  productId?: string;
  partyId?: string;
  voucherNo?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("stock_ledger")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(filters?.limit ?? 500);
    if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
    if (filters?.productId) query = query.eq("product_id", filters.productId);
    if (filters?.partyId) query = query.eq("party_id", filters.partyId);
    if (filters?.voucherNo) query = query.eq("voucher_no", filters.voucherNo);
    if (filters?.from) query = query.gte("date", filters.from);
    if (filters?.to) query = query.lte("date", filters.to);
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Transfers ----------------
/** Creates a transfer in DRAFT status — no ledger movement until posted. */
export async function createTransfer(input: {
  fromGodownId: string;
  toGodownId: string;
  productId: string;
  quantityKg: number;
  reason: string;
  partyId?: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    if (!input?.fromGodownId || !input?.toGodownId || !input?.productId) {
      return fail("fromGodownId, toGodownId and productId are required");
    }
    if (input.fromGodownId === input.toGodownId) {
      return fail("Transfer source and destination godowns must differ");
    }
    if (!input.quantityKg || input.quantityKg <= 0) return fail("Transfer quantity must be > 0");
    if (!input.reason?.trim()) return fail("A transfer reason is required");
    const supabase = await createClient();
    const transferNo = await nextDocNumber(supabase, "transfer", "TRF");
    const { data, error } = await supabase
      .from("godown_transfers")
      .insert({
        transfer_no: transferNo,
        from_godown_id: input.fromGodownId,
        to_godown_id: input.toGodownId,
        product_id: input.productId,
        quantity: roundWeight(input.quantityKg),
        unit: "kg",
        reason: input.reason.trim(),
        party_id: input.partyId ?? null,
        notes: input.notes ?? null,
        status: "draft",
      })
      .select()
      .single();
    if (error) return fail(error.message);
    revalidateInventory();
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function postTransfer(id: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const replay = await checkIdempotency(supabase, "transfer:post", clientToken);
    if (replay) return replay;
    const { data: transfer, error } = await supabase
      .from("godown_transfers")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    if (transfer.status === "posted") return fail(`Transfer ${transfer.transfer_no} is already posted`);
    if (transfer.status !== "draft") return fail(`Only a draft can be posted (status: ${transfer.status})`);
    const qty = roundWeight(transfer.quantity);
    // Stock guard on the source godown (party-scoped when an owner is set).
    const available = await stockBalance(supabase, transfer.from_godown_id, transfer.product_id, transfer.party_id ?? null);
    if (available < qty) {
      return fail(
        `Insufficient stock for transfer ${transfer.transfer_no}: available ${available} kg in source godown, requested ${qty} kg`,
      );
    }
    const by = await createdBy(supabase);
    await appendLedger(
      supabase,
      {
        voucher_type: "transfer",
        voucher_id: transfer.id,
        voucher_no: transfer.transfer_no,
        godown_id: transfer.from_godown_id,
        product_id: transfer.product_id,
        party_id: transfer.party_id ?? null,
        inward_qty: 0,
        outward_qty: qty,
        notes: `Transfer out to godown ${transfer.to_godown_id}: ${transfer.reason ?? ""}`.trim(),
      },
      by,
    );
    await appendLedger(
      supabase,
      {
        voucher_type: "transfer",
        voucher_id: transfer.id,
        voucher_no: transfer.transfer_no,
        godown_id: transfer.to_godown_id,
        product_id: transfer.product_id,
        party_id: transfer.party_id ?? null,
        inward_qty: qty,
        outward_qty: 0,
        notes: `Transfer in from godown ${transfer.from_godown_id}: ${transfer.reason ?? ""}`.trim(),
      },
      by,
    );
    const { data: posted, error: uError } = await supabase
      .from("godown_transfers")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError) return fail(uError.message);
    await storeIdempotency(supabase, "transfer:post", clientToken, "transfer", id, transfer.transfer_no, posted);
    revalidateInventory();
    return ok(posted);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function reverseTransfer(id: string, reason: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A reversal reason is mandatory");
    const supabase = await createClient();
    const replay = await checkIdempotency(supabase, "transfer:reverse", clientToken);
    if (replay) return replay;
    const { data: transfer, error } = await supabase
      .from("godown_transfers")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    if (transfer.status !== "posted") {
      return fail(`Only a posted transfer can be reversed (status: ${transfer.status})`);
    }
    const qty = roundWeight(transfer.quantity);
    const available = await stockBalance(supabase, transfer.to_godown_id, transfer.product_id, transfer.party_id ?? null);
    if (available < qty) {
      return fail(
        `Cannot reverse transfer ${transfer.transfer_no}: destination godown holds only ${available} kg, reversal needs ${qty} kg`,
      );
    }
    const by = await createdBy(supabase);
    await appendLedger(
      supabase,
      {
        voucher_type: "transfer",
        voucher_id: transfer.id,
        voucher_no: transfer.transfer_no,
        godown_id: transfer.to_godown_id,
        product_id: transfer.product_id,
        party_id: transfer.party_id ?? null,
        inward_qty: 0,
        outward_qty: qty,
        notes: `Reversal of ${transfer.transfer_no}: ${reason.trim()}`,
      },
      by,
    );
    await appendLedger(
      supabase,
      {
        voucher_type: "transfer",
        voucher_id: transfer.id,
        voucher_no: transfer.transfer_no,
        godown_id: transfer.from_godown_id,
        product_id: transfer.product_id,
        party_id: transfer.party_id ?? null,
        inward_qty: qty,
        outward_qty: 0,
        notes: `Reversal of ${transfer.transfer_no}: ${reason.trim()}`,
      },
      by,
    );
    const { data: reversed, error: uError } = await supabase
      .from("godown_transfers")
      .update({ status: "reversed", reversal_reason: reason.trim(), reversed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError) return fail(uError.message);
    await storeIdempotency(supabase, "transfer:reverse", clientToken, "transfer", id, transfer.transfer_no, reversed);
    revalidateInventory();
    return ok(reversed);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Adjustments ----------------
/** Creates an adjustment in DRAFT status. `quantityBefore` is verified against the live ledger balance. */
export async function createAdjustment(input: {
  godownId: string;
  productId: string;
  quantityBeforeKg: number;
  quantityAfterKg: number;
  reason: string;
  approver: string;
  partyId?: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    if (!input?.godownId || !input?.productId) return fail("godownId and productId are required");
    if (!input.reason?.trim()) return fail("An adjustment reason is required");
    if (!input.approver?.trim()) return fail("An approver is required for adjustments");
    if (input.quantityBeforeKg < 0 || input.quantityAfterKg < 0) {
      return fail("Adjustment quantities must be >= 0");
    }
    if (input.quantityBeforeKg === input.quantityAfterKg) {
      return fail("Adjustment before and after quantities are identical — nothing to adjust");
    }
    const supabase = await createClient();
    const live = await stockBalance(supabase, input.godownId, input.productId, input.partyId ?? null);
    if (roundWeight(input.quantityBeforeKg) !== live) {
      return fail(
        `Adjustment "before" quantity (${input.quantityBeforeKg} kg) does not match the live ledger balance (${live} kg). Refresh and re-enter the adjustment.`,
      );
    }
    const adjustmentNo = await nextDocNumber(supabase, "adjustment", "ADJ");
    const { data, error } = await supabase
      .from("stock_adjustments")
      .insert({
        adjustment_no: adjustmentNo,
        godown_id: input.godownId,
        product_id: input.productId,
        party_id: input.partyId ?? null,
        quantity_before: roundWeight(input.quantityBeforeKg),
        quantity_after: roundWeight(input.quantityAfterKg),
        delta_qty: roundWeight(input.quantityAfterKg - input.quantityBeforeKg),
        reason: input.reason.trim(),
        approver: input.approver.trim(),
        notes: input.notes ?? null,
        status: "draft",
      })
      .select()
      .single();
    if (error) return fail(error.message);
    revalidateInventory();
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function postAdjustment(id: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const replay = await checkIdempotency(supabase, "adjustment:post", clientToken);
    if (replay) return replay;
    const { data: adj, error } = await supabase.from("stock_adjustments").select("*").eq("id", id).single();
    if (error) return fail(error.message);
    if (adj.status === "posted") return fail(`Adjustment ${adj.adjustment_no} is already posted`);
    if (adj.status !== "draft") return fail(`Only a draft can be posted (status: ${adj.status})`);
    // Re-verify "before" at posting time — stock may have moved since the draft.
    const live = await stockBalance(supabase, adj.godown_id, adj.product_id, adj.party_id ?? null);
    if (roundWeight(adj.quantity_before) !== live) {
      return fail(
        `Cannot post adjustment ${adj.adjustment_no}: live balance is now ${live} kg, but the adjustment was recorded against ${adj.quantity_before} kg. Create a fresh adjustment.`,
      );
    }
    const delta = roundWeight(adj.delta_qty);
    if (delta < 0) {
      const available = live;
      if (available < Math.abs(delta)) {
        return fail(`Insufficient stock for adjustment ${adj.adjustment_no}: available ${available} kg, adjustment removes ${Math.abs(delta)} kg`);
      }
    }
    const by = await createdBy(supabase);
    await appendLedger(
      supabase,
      {
        voucher_type: "adjustment",
        voucher_id: adj.id,
        voucher_no: adj.adjustment_no,
        godown_id: adj.godown_id,
        product_id: adj.product_id,
        party_id: adj.party_id ?? null,
        inward_qty: delta > 0 ? delta : 0,
        outward_qty: delta < 0 ? Math.abs(delta) : 0,
        notes: `Adjustment approved by ${adj.approver}: ${adj.reason}`,
      },
      by,
    );
    const { data: posted, error: uError } = await supabase
      .from("stock_adjustments")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError) return fail(uError.message);
    await storeIdempotency(supabase, "adjustment:post", clientToken, "adjustment", id, adj.adjustment_no, posted);
    revalidateInventory();
    return ok(posted);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function reverseAdjustment(id: string, reason: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A reversal reason is mandatory");
    const supabase = await createClient();
    const replay = await checkIdempotency(supabase, "adjustment:reverse", clientToken);
    if (replay) return replay;
    const { data: adj, error } = await supabase.from("stock_adjustments").select("*").eq("id", id).single();
    if (error) return fail(error.message);
    if (adj.status !== "posted") {
      return fail(`Only a posted adjustment can be reversed (status: ${adj.status})`);
    }
    const delta = roundWeight(adj.delta_qty);
    if (delta > 0) {
      const live = await stockBalance(supabase, adj.godown_id, adj.product_id, adj.party_id ?? null);
      if (live < delta) {
        return fail(`Cannot reverse adjustment ${adj.adjustment_no}: available stock is ${live} kg, reversal removes ${delta} kg`);
      }
    }
    const by = await createdBy(supabase);
    await appendLedger(
      supabase,
      {
        voucher_type: "adjustment",
        voucher_id: adj.id,
        voucher_no: adj.adjustment_no,
        godown_id: adj.godown_id,
        product_id: adj.product_id,
        party_id: adj.party_id ?? null,
        inward_qty: delta < 0 ? Math.abs(delta) : 0,
        outward_qty: delta > 0 ? delta : 0,
        notes: `Reversal of ${adj.adjustment_no}: ${reason.trim()}`,
      },
      by,
    );
    const { data: reversed, error: uError } = await supabase
      .from("stock_adjustments")
      .update({ status: "reversed", reversal_reason: reason.trim(), reversed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError) return fail(uError.message);
    await storeIdempotency(supabase, "adjustment:reverse", clientToken, "adjustment", id, adj.adjustment_no, reversed);
    revalidateInventory();
    return ok(reversed);
  } catch (e) {
    return fail(errMessage(e));
  }
}
