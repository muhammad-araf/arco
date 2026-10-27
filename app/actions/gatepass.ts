"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireSignedIn, type Actor } from "./auth";
import { STOCK_WRITE } from "./auth-helpers";
import { logAudit } from "@/lib/audit";
import {
  roundWeight,
  ledgerRunningBalance,
  stockBalanceFromRows,
  aggregatePoolQuantities,
  ownersForProduct,
  remainingReturnable,
  validateCumulativeReturns,
  gatePassStatusAfterReturn,
} from "@/lib/calc";

/**
 * Gate pass (dispatch) server actions.
 *
 * Flow: createGatePassDraft -> postGatePass -> reverseGatePass(reason)
 *                                        \-> returnGatePass(...)
 * - Pass numbers are generated server-side via the doc_numbering sequence
 *   (series "gatepass", prefix "GP"); a client-supplied pass number is
 *   never accepted, and a number is never reused — reversed/returned
 *   passes keep their number forever.
 * - Posting deducts stock exactly once (status guard + clientToken
 *   idempotency) and is blocked per line/godown by the stock guard:
 *   no outward posting may drive any (godown, product, owner) balance
 *   negative. A line's partyId, when set, scopes the guard and the
 *   ledger row to that owner's stock (customer-owned dispatch); without
 *   it the dispatch is against company-owned stock.
 * - Return: only a posted pass can be returned. By default the whole pass
 *   is returned; pass `items` to return specific products/quantities
 *   (partial return). Returned stock comes back via inward ledger rows
 *   and each returned line is recorded in gate_pass_returns.
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
function revalidateGatepass(): void {
  revalidatePath("/gatepass");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

async function requireWrite(
  db: Db,
): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireRole(db, STOCK_WRITE);
  if (!gate.ok) return { error: gate.error };
  return { actor: gate.actor };
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

async function stockBalance(supabase: Db, godownId: string, productId: string, partyId: string | null): Promise<number> {
  // DB-side aggregate first (supabase/migration-stock-summary-rpc.sql);
  // falls back to the ledger scan when the RPC was never applied.
  const rpc = await supabase.rpc("stock_summary");
  if (!rpc.error && Array.isArray(rpc.data)) {
    const row = (rpc.data as { godown_id: string; product_id: string; party_id: string | null; balance_kg: number }[]).find(
      (r) => r.godown_id === godownId && r.product_id === productId && (r.party_id ?? null) === partyId,
    );
    return roundWeight(Number(row?.balance_kg) || 0);
  }
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

/** Opening stock (kind "stock") for one pool; a query error degrades to 0 (stricter guard). */
async function openingBalance(supabase: Db, godownId: string, productId: string, partyId: string | null): Promise<number> {
  let query = supabase
    .from("opening_balances")
    .select("quantity")
    .eq("balance_kind", "stock")
    .eq("godown_id", godownId)
    .eq("product_id", productId);
  if (partyId) query = query.eq("party_id", partyId);
  else query = query.is("party_id", null);
  const { data, error } = await query;
  if (error) return 0;
  return roundWeight((data ?? []).reduce((s, r: { quantity: number }) => s + (Number(r.quantity) || 0), 0));
}

/** Physical availability for guards: ledger balance + opening stock. */
async function physicalBalance(supabase: Db, godownId: string, productId: string, partyId: string | null): Promise<number> {
  return roundWeight(
    (await stockBalance(supabase, godownId, productId, partyId)) +
      (await openingBalance(supabase, godownId, productId, partyId)),
  );
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
export async function listGatePasses(filters?: {
  status?: string;
  customerId?: string;
  godownId?: string;
  from?: string;
  to?: string;
}): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    let query = supabase
      .from("gate_passes")
      .select("*, gate_pass_items(*)")
      .order("date", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.customerId) query = query.eq("customer_id", filters.customerId);
    if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
    if (filters?.from) query = query.gte("date", filters.from);
    if (filters?.to) query = query.lte("date", filters.to);
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function getGatePass(id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase
      .from("gate_passes")
      .select("*, gate_pass_items(*), gate_pass_returns(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Draft ----------------
export async function createGatePassDraft(input: {
  customerId: string;
  godownId: string;
  vehicleNo: string;
  driverName: string;
  driverPhone?: string;
  transporter?: string;
  destination?: string;
  orderRef?: string;
  date?: string;
  notes?: string;
  items: {
    productId: string;
    bags: number;
    netWeightKg: number;
    grossWeightKg?: number;
    remarks?: string;
    /** Owner of this line's stock; omit for company-owned stock. */
    partyId?: string;
  }[];
}): Promise<ActionResult> {
  try {
    if (!input?.customerId || !input?.godownId) return fail("customerId and godownId are required");
    if (!input.vehicleNo?.trim() || !input.driverName?.trim()) {
      return fail("vehicleNo and driverName are required");
    }
    if (!input.items?.length) return fail("At least one item line is required");
    for (const item of input.items) {
      if (!item.productId) return fail("Every item needs a productId");
      if (item.bags < 0 || item.netWeightKg <= 0) {
        return fail("Item bags must be >= 0 and net weight must be > 0");
      }
    }
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const passNo = await nextDocNumber(supabase, "gatepass", "GP");
    const totalBags = input.items.reduce((s, i) => s + i.bags, 0);
    const totalWeight = roundWeight(input.items.reduce((s, i) => s + i.netWeightKg, 0));
    const { data: pass, error } = await supabase
      .from("gate_passes")
      .insert({
        pass_no: passNo,
        date: input.date ?? new Date().toISOString(),
        customer_id: input.customerId,
        godown_id: input.godownId,
        destination: input.destination ?? null,
        vehicle_no: input.vehicleNo.trim(),
        driver_name: input.driverName.trim(),
        driver_phone: input.driverPhone ?? null,
        transporter: input.transporter ?? null,
        order_ref: input.orderRef ?? null,
        status: "draft",
        total_bags: totalBags,
        total_weight_kg: totalWeight,
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) return fail(error.message);
    // party_id on the line (schema appendix column) scopes the guard and
    // the ledger row to the owner's stock pool; null = company-owned.
    const lines = input.items.map((item) => ({
      gate_pass_id: pass.id,
      product_id: item.productId,
      bags_count: item.bags,
      net_weight_kg: roundWeight(item.netWeightKg),
      gross_weight_kg: roundWeight(item.grossWeightKg ?? item.netWeightKg),
      remarks: item.remarks ?? null,
      party_id: item.partyId ?? null,
    }));
    const { error: iError } = await supabase.from("gate_pass_items").insert(lines);
    if (iError) {
      await supabase.from("gate_passes").delete().eq("id", pass.id);
      return fail(iError.message);
    }
    revalidateGatepass();
    return ok({ ...pass, items: lines });
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Post ----------------
export async function postGatePass(id: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "gatepass:post", clientToken);
    if (replay) return replay;
    const { data: pass, error } = await supabase
      .from("gate_passes")
      .select("*, gate_pass_items(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    if (pass.status === "posted") return fail(`Gate pass ${pass.pass_no} is already posted`);
    if (pass.status !== "draft") return fail(`Only a draft can be posted (status: ${pass.status})`);
    const items = (pass.gate_pass_items ?? []) as {
      product_id: string;
      net_weight_kg: number;
      party_id: string | null;
    }[];
    if (!items.length) return fail("Cannot post a gate pass with no items");
    // Stock guard per line/godown/owner. Aggregate duplicate
    // (product, owner) lines before guarding, so two lines for the same
    // product cannot each pass the guard and jointly go negative.
    // party_id null = company-owned stock; a set party_id draws ONLY
    // that owner's stock, never company stock.
    const itemsWithParty = items as { product_id: string; net_weight_kg: number; party_id: string | null }[];
    const required = aggregatePoolQuantities(
      itemsWithParty.map((item) => ({
        productId: item.product_id,
        partyId: item.party_id ?? null,
        qtyKg: roundWeight(item.net_weight_kg),
      })),
    );
    for (const { productId, partyId, qtyKg } of required) {
      const available = await physicalBalance(supabase, pass.godown_id, productId, partyId);
      if (available < qtyKg) {
        return fail(
          `Insufficient stock for gate pass ${pass.pass_no}: product ${productId} has ${available} kg available in this godown${partyId ? " for this owner" : ""}, pass needs ${qtyKg} kg`,
        );
      }
    }
    const by = gate.actor.userId;
    for (const item of items) {
      await appendLedger(
        supabase,
        {
          voucher_type: "gatepass",
          voucher_id: pass.id,
          voucher_no: pass.pass_no,
          godown_id: pass.godown_id,
          product_id: item.product_id,
          party_id: item.party_id ?? null,
          inward_qty: 0,
          outward_qty: roundWeight(item.net_weight_kg),
        },
        by,
      );
    }
    const { data: posted, error: uError } = await supabase
      .from("gate_passes")
      .update({ status: "posted", dispatched_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError) return fail(uError.message);
    const result = { ...posted, items };
    await logAudit(supabase, {
      action: "post",
      entityType: "gate_passes",
      entityId: id,
      voucherNo: pass.pass_no,
      before: { status: "draft" },
      after: { status: "posted" },
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    await storeIdempotency(supabase, "gatepass:post", clientToken, "gatepass", id, pass.pass_no, result);
    revalidateGatepass();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Reverse ----------------
export async function reverseGatePass(id: string, reason: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A reversal reason is mandatory");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "gatepass:reverse", clientToken);
    if (replay) return replay;
    const { data: pass, error } = await supabase
      .from("gate_passes")
      .select("*, gate_pass_items(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    if (pass.status === "returned") {
      return fail(`Gate pass ${pass.pass_no} is already fully returned — its stock is already back, so a reversal would double-credit it`);
    }
    if (pass.status !== "posted" && pass.status !== "partially_returned") {
      return fail(`Only a posted or partially returned gate pass can be reversed (status: ${pass.status})`);
    }
    const items = (pass.gate_pass_items ?? []) as {
      product_id: string;
      net_weight_kg: number;
      party_id: string | null;
    }[];
    // A partially returned pass already has part of its stock back via
    // return ledger rows: reversing credits ONLY the unreturned
    // remainder, never the full dispatched quantity again.
    const { data: priorReturns } = await supabase
      .from("gate_pass_returns")
      .select("product_id, party_id, qty_kg")
      .eq("gate_pass_id", id);
    const dispatchedPools = items.map((item) => ({
      productId: item.product_id,
      partyId: item.party_id ?? null,
      qtyKg: roundWeight(item.net_weight_kg),
    }));
    const priorPools = ((priorReturns ?? []) as { product_id: string; party_id: string | null; qty_kg: number }[]).map(
      (r) => ({ productId: r.product_id, partyId: r.party_id ?? null, qtyKg: roundWeight(r.qty_kg) }),
    );
    const toRestore = pass.status === "partially_returned" ? remainingReturnable(dispatchedPools, priorPools) : dispatchedPools;
    const by = gate.actor.userId;
    for (const item of toRestore) {
      await appendLedger(
        supabase,
        {
          voucher_type: "gatepass",
          voucher_id: pass.id,
          voucher_no: pass.pass_no,
          godown_id: pass.godown_id,
          product_id: item.productId,
          party_id: item.partyId,
          inward_qty: roundWeight(item.qtyKg),
          outward_qty: 0,
          notes: `Reversal of ${pass.pass_no}: ${reason.trim()}`,
        },
        by,
      );
    }
    const { data: reversed, error: uError } = await supabase
      .from("gate_passes")
      .update({ status: "reversed", reversal_reason: reason.trim(), reversed_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["posted", "partially_returned"])
      .select()
      .single();
    if (uError) return fail(uError.message);
    const result = { ...reversed, items };
    await logAudit(supabase, {
      action: "reverse",
      entityType: "gate_passes",
      entityId: id,
      voucherNo: pass.pass_no,
      before: { status: pass.status },
      after: { status: "reversed" },
      reason: reason.trim(),
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    await storeIdempotency(supabase, "gatepass:reverse", clientToken, "gatepass", id, pass.pass_no, result);
    revalidateGatepass();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Return ----------------
export async function returnGatePass(
  id: string,
  input: {
    reason: string;
    /** If omitted, the whole remaining (not yet returned) quantity is returned. Quantities are kg. */
    items?: { productId: string; qtyKg: number; partyId?: string }[];
  },
  clientToken?: string,
): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!input?.reason?.trim()) return fail("A return reason is mandatory");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "gatepass:return", clientToken);
    if (replay) return replay;
    const { data: pass, error } = await supabase
      .from("gate_passes")
      .select("*, gate_pass_items(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    // A partially returned pass stays returnable until nothing remains:
    // it is never stranded by an early flip to "returned".
    if (pass.status !== "posted" && pass.status !== "partially_returned") {
      return fail(`Only a posted or partially returned gate pass can be returned (status: ${pass.status})`);
    }
    const dispatched = (pass.gate_pass_items ?? []) as {
      product_id: string;
      net_weight_kg: number;
      party_id: string | null;
    }[];
    const dispatchedPools = dispatched.map((d) => ({
      productId: d.product_id,
      partyId: d.party_id ?? null,
      qtyKg: roundWeight(d.net_weight_kg),
    }));
    const { data: priorRows, error: priorError } = await supabase
      .from("gate_pass_returns")
      .select("product_id, party_id, qty_kg")
      .eq("gate_pass_id", id);
    if (priorError) return fail(priorError.message);
    const priorPools = ((priorRows ?? []) as { product_id: string; party_id: string | null; qty_kg: number }[]).map(
      (r) => ({ productId: r.product_id, partyId: r.party_id ?? null, qtyKg: roundWeight(r.qty_kg) }),
    );
    let returns: { productId: string; qtyKg: number; partyId: string | null }[];
    if (input?.items?.length) {
      // Owner attribution is explicit, never guessed: when a product was
      // dispatched from more than one owner pool, the entry MUST name
      // its owner. With a single pool the owner is unambiguous, so an
      // omitted partyId resolves to that one pool.
      const resolved = input.items.map((r) => {
        const owners = ownersForProduct(dispatchedPools, r.productId);
        if (owners.length > 1 && r.partyId === undefined) {
          throw new Error(
            `Return for product ${r.productId} must specify its owner: this pass dispatched it from more than one owner pool`,
          );
        }
        return {
          productId: r.productId,
          qtyKg: roundWeight(r.qtyKg),
          partyId: r.partyId !== undefined ? r.partyId : (owners[0] ?? null),
        };
      });
      const checked = validateCumulativeReturns(dispatchedPools, priorPools, resolved);
      if (!checked.ok) return fail(checked.error);
      returns = checked.aggregated;
    } else {
      returns = remainingReturnable(dispatchedPools, priorPools);
      if (!returns.length) return fail(`Gate pass ${pass.pass_no} has nothing left to return`);
    }
    const dispatchedTotal = roundWeight(dispatchedPools.reduce((s, d) => s + d.qtyKg, 0));
    const priorTotal = roundWeight(priorPools.reduce((s, d) => s + d.qtyKg, 0));
    const newTotal = roundWeight(priorTotal + returns.reduce((s, r) => s + r.qtyKg, 0));
    const newStatus = gatePassStatusAfterReturn(dispatchedTotal, newTotal);
    // Return records FIRST, with their insert error checked: a failed
    // insert aborts the return before any ledger row or status flip, so
    // the pass can never flip to returned with no audit record.
    const { data: inserted, error: insertError } = await supabase
      .from("gate_pass_returns")
      .insert(
        returns.map((ret) => ({
          gate_pass_id: pass.id,
          product_id: ret.productId,
          party_id: ret.partyId,
          qty_kg: roundWeight(ret.qtyKg),
          reason: input.reason.trim(),
        })),
      )
      .select("id");
    if (insertError) return fail(insertError.message);
    const by = gate.actor.userId;
    try {
      for (const ret of returns) {
        await appendLedger(
          supabase,
          {
            voucher_type: "gatepass",
            voucher_id: pass.id,
            voucher_no: pass.pass_no,
            godown_id: pass.godown_id,
            product_id: ret.productId,
            party_id: ret.partyId,
            inward_qty: roundWeight(ret.qtyKg),
            outward_qty: 0,
            notes: `Return of ${pass.pass_no}: ${input.reason.trim()}`,
          },
          by,
        );
      }
    } catch (e) {
      // Ledger failed after the return records were written: remove just
      // those records so the return leaves no partial trace, then fail.
      if (inserted?.length) {
        await supabase
          .from("gate_pass_returns")
          .delete()
          .in(
            "id",
            (inserted as { id: string }[]).map((r) => r.id),
          );
      }
      throw e;
    }
    const { data: returned, error: uError } = await supabase
      .from("gate_passes")
      .update({
        status: newStatus,
        return_reason: input.reason.trim(),
        returned_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", ["posted", "partially_returned"])
      .select()
      .single();
    if (uError) return fail(uError.message);
    const result = { ...returned, returns };
    await logAudit(supabase, {
      action: "return",
      entityType: "gate_passes",
      entityId: id,
      voucherNo: pass.pass_no,
      before: { status: pass.status },
      after: { status: newStatus },
      reason: input.reason.trim(),
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    await storeIdempotency(supabase, "gatepass:return", clientToken, "gatepass", id, pass.pass_no, result);
    revalidateGatepass();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}
