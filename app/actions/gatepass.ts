"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireSignedIn, type Actor } from "./auth";
import { STOCK_WRITE, OWNER_ONLY } from "./auth-helpers";
import { logAudit } from "@/lib/audit";
import { callAtomicStockTransition } from "@/lib/atomic";
import { isUniqueViolation } from "@/lib/idempotency";
import {
  roundWeight,
  ledgerRunningBalance,
  stockBalanceFromRows,
  aggregatePoolQuantities,
  ownersForProduct,
  remainingReturnable,
  validateCumulativeReturns,
  gatePassStatusAfterReturn,
  acceptedRestockQuantities,
} from "@/lib/calc";
import { listGodowns, listProducts, listParties, listPackagingTypes } from "./masters";
import { getStockSummary } from "./inventory";
import { getCompanySettings } from "./settings";

/**
 * Gate pass (dispatch) server actions.
 *
 * Flow: createGatePassDraft -> postGatePass -> reverseGatePass(reason)
 *                                        \-> returnGatePass(...)
 * - Pass numbers are generated server-side via the doc_numbering sequence
 *   (series "gatepass", prefix "GP"); a client-supplied pass number is
 *   never accepted, and a number is never reused — reversed/returned
 *   passes keep their number forever.
 * - Posting deducts stock exactly once (atomic_stock_transition:
 *   one transaction, voucher-row lock, clientToken idempotency)
 *   and is blocked per line/godown by the stock guard:
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

/** Display name for sign-off columns: profile name, else email, else id. */
function actorName(actor: Actor): string {
  return actor.displayName ?? actor.email ?? actor.userId;
}

/**
 * Spec §9.3 step 4 approval gate. The `gatepass_approval_required`
 * app_settings row is owned by the settings team; when it is absent
 * (or unreadable, or any other shape) approval is OFF and posting
 * behaves exactly as before. Accepted shapes: `true`, `"true"`, or an
 * object with `required` / `enabled` / `value` true — the reader stays
 * liberal because the settings team owns the stored shape.
 */
async function gatepassApprovalRequired(supabase: Db): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "gatepass_approval_required")
      .maybeSingle();
    if (error || !data) return false;
    const v = (data as { value?: unknown }).value;
    if (v === true || v === "true") return true;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return o.required === true || o.enabled === true || o.value === true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Stock guard shared by post + approve: aggregated per pool, never negative. */
async function guardStock(
  supabase: Db,
  pass: { pass_no: string; godown_id: string },
  items: { product_id: string; net_weight_kg: number; party_id: string | null }[],
): Promise<string | null> {
  const required = aggregatePoolQuantities(
    items.map((item) => ({
      productId: item.product_id,
      partyId: item.party_id ?? null,
      qtyKg: roundWeight(item.net_weight_kg),
    })),
  );
  for (const { productId, partyId, qtyKg } of required) {
    const available = await physicalBalance(supabase, pass.godown_id, productId, partyId);
    if (available < qtyKg) {
      return (
        `Insufficient stock for gate pass ${pass.pass_no}: product ${productId} has ${available} kg available in this godown${partyId ? " for this owner" : ""}, pass needs ${qtyKg} kg`
      );
    }
  }
  return null;
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
  // The table's primary key is (client_token, scope): naming only
  // client_token made Postgres reject this upsert, so stored tokens
  // silently never landed and replays never hit (B4).
  await supabase.from("idempotency_keys").upsert(
    { client_token: clientToken, scope, voucher_type: voucherType, voucher_id: voucherId, voucher_no: voucherNo, result },
    { onConflict: "client_token,scope" },
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

/**
 * Ledger writer for the paths the atomic function does NOT cover
 * (gate-pass returns: the return records must land first, and the
 * status flip depends on cumulative-return math). The row carries
 * its (entry_kind, line_no) identity, and a unique-violation on that
 * identity means this exact line is already written — skip it so a
 * retry after a crash converges instead of failing on its own rows.
 */
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
    entryKind: string;
    lineNo: number;
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
    entry_kind: row.entryKind,
    line_no: row.lineNo,
  });
  if (error && isUniqueViolation(error)) return;
  if (error) throw new Error(error.message);
}

// ---------------- Reads ----------------
export async function listGatePasses(filters?: {
  status?: string;
  customerId?: string;
  godownId?: string;
  vehicleNo?: string;
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
    if (filters?.vehicleNo) query = query.ilike("vehicle_no", `%${filters.vehicleNo}%`);
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
  /** Person physically receiving the goods (spec §9). */
  receiverName?: string;
  receiverContact?: string;
  /** How the goods leave: free text from the form select. */
  dispatchMode?: string;
  /** Reference-only attachment link + note (never required). */
  attachmentUrl?: string;
  attachmentNote?: string;
  items: {
    productId: string;
    bags: number;
    netWeightKg: number;
    grossWeightKg?: number;
    remarks?: string;
    /** Owner of this line's stock; omit for company-owned stock. */
    partyId?: string;
    /** Bag type for this line; omit when no specific type applies. */
    packagingTypeId?: string;
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
    // Duplicate order-reference WARNING (non-blocking — duplicates may
    // be legitimate, e.g. one order split across passes). A lookup
    // failure degrades to no warning, never to a blocked creation.
    let duplicateOrderRefWarning: string | undefined;
    const orderRef = input.orderRef?.trim() || null;
    if (orderRef) {
      try {
        const { data: dupes, error: dupeError } = await supabase
          .from("gate_passes")
          .select("pass_no")
          .eq("order_ref", orderRef)
          .limit(5);
        if (!dupeError && dupes?.length) {
          duplicateOrderRefWarning =
            `Order reference "${orderRef}" is already used on ${(dupes as { pass_no: string }[]).map((d) => d.pass_no).join(", ")} — duplicates may be legitimate, so this pass was still created.`;
        }
      } catch {
        duplicateOrderRefWarning = undefined;
      }
    }
    const passNo = await nextDocNumber(supabase, "gatepass", "GP");
    const totalBags = input.items.reduce((s, i) => s + i.bags, 0);
    const totalWeight = roundWeight(input.items.reduce((s, i) => s + i.netWeightKg, 0));
    let { data: pass, error } = await supabase
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
        order_ref: orderRef,
        receiver_name: input.receiverName?.trim() || null,
        receiver_contact: input.receiverContact?.trim() || null,
        dispatch_mode: input.dispatchMode?.trim() || null,
        created_by: gate.actor.userId,
        attachment_url: input.attachmentUrl?.trim() || null,
        attachment_note: input.attachmentNote?.trim() || null,
        prepared_by: actorName(gate.actor),
        status: "draft",
        total_bags: totalBags,
        total_weight_kg: totalWeight,
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) {
      if (/column .* does not exist/i.test(error.message)) {
        const retry = await supabase
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
            order_ref: orderRef,
            receiver_name: input.receiverName?.trim() || null,
            receiver_contact: input.receiverContact?.trim() || null,
            dispatch_mode: input.dispatchMode?.trim() || null,
            created_by: gate.actor.userId,
            prepared_by: actorName(gate.actor),
            status: "draft",
            total_bags: totalBags,
            total_weight_kg: totalWeight,
            notes: input.notes ?? null,
          })
          .select()
          .single();
        if (retry.error) return fail(retry.error.message);
        pass = retry.data;
      } else {
        return fail(error.message);
      }
    }
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
      packaging_type_id: item.packagingTypeId ?? null,
    }));
    const { error: iError } = await supabase.from("gate_pass_items").insert(lines);
    if (iError) {
      await supabase.from("gate_passes").delete().eq("id", pass.id);
      return fail(iError.message);
    }
    revalidateGatepass();
    return ok({ ...pass, items: lines, duplicateOrderRefWarning });
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
    // Already posted is a successful replay, not a second posting.
    // Already awaiting approval is likewise a replay: approval, not
    // another post, is what moves it to posted.
    if (pass.status === "posted") return ok(pass);
    if (pass.status === "awaiting_approval") return ok(pass);
    if (pass.status !== "draft") return fail(`Only a draft can be posted (status: ${pass.status})`);
    const items = (pass.gate_pass_items ?? []) as {
      product_id: string;
      net_weight_kg: number;
      party_id: string | null;
    }[];
    if (!items.length) return fail("Cannot post a gate pass with no items");
    // Spec §9.3 step 4, setting-gated: when approval is required,
    // posting only submits the pass for approval — NO stock change
    // happens here. The stock guard and deduction run at approval.
    if (await gatepassApprovalRequired(supabase)) {
      const { data: submitted, error: uError } = await supabase
        .from("gate_passes")
        .update({ status: "awaiting_approval", updated_by: gate.actor.userId })
        .eq("id", id)
        .in("status", ["draft"])
        .select()
        .single();
      if (uError) return fail(uError.message);
      const result = { ...submitted, items };
      await logAudit(supabase, {
        action: "submit_for_approval",
        entityType: "gate_passes",
        entityId: id,
        voucherNo: pass.pass_no,
        before: { status: "draft" },
        after: { status: "awaiting_approval" },
        userId: gate.actor.userId,
        userEmail: gate.actor.email,
      });
      await storeIdempotency(supabase, "gatepass:post", clientToken, "gatepass", id, pass.pass_no, result);
      revalidateGatepass();
      return ok(result);
    }
    // Stock guard per line/godown/owner. Aggregate duplicate
    // (product, owner) lines before guarding, so two lines for the same
    // product cannot each pass the guard and jointly go negative.
    // party_id null = company-owned stock; a set party_id draws ONLY
    // that owner's stock, never company stock.
    const guardError = await guardStock(supabase, pass, items);
    if (guardError) return fail(guardError);
    // Atomic post (B4): ledger lines + status flip + idempotency key
    // in one transaction via atomic_stock_transition (see inward.ts).
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "gate_passes",
      voucherId: id,
      fromStatuses: ["draft"],
      toStatus: "posted",
      voucherType: "gatepass",
      voucherNo: pass.pass_no,
      entryKind: "post",
      lines: items.map((item, i) => ({
        lineNo: i,
        godownId: pass.godown_id,
        productId: item.product_id,
        partyId: item.party_id ?? null,
        inwardQty: 0,
        outwardQty: roundWeight(item.net_weight_kg),
      })),
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "gatepass:post",
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a draft can be posted (status: ${transition.result.status})`);
    }
    const posted = transition.result.voucher as Record<string, unknown>;
    const result: Record<string, unknown> = { ...posted, items };
    // Sign-off: the poster approves when no approval step is configured.
    // Best-effort AFTER the atomic flip — a failed name update must not
    // report the post as failed once stock has already moved; the name
    // is still carried in the returned row for the UI/print.
    await supabase
      .from("gate_passes")
      .update({ approved_by: actorName(gate.actor), updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "posted");
    result.approved_by = actorName(gate.actor);
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
    revalidateGatepass();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Approval (spec §9.3 step 4, setting-gated) ----------------
/**
 * Approve an awaiting_approval pass: the stock guard runs HERE (not at
 * submit time, so stock is checked against the moment of approval) and
 * the atomic transition deducts stock exactly once, as a normal post.
 *
 * INTERIM, pending the client's §19 definition of who approves: gated
 * via the EXISTING requireRole helper with the EXISTING owner_admin
 * role (OWNER_ONLY). No new role is invented and no role logic changes.
 */
export async function approveGatePass(id: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireRole(supabase, OWNER_ONLY);
    if (!gate.ok) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "gatepass:approve", clientToken);
    if (replay) return replay;
    const { data: pass, error } = await supabase
      .from("gate_passes")
      .select("*, gate_pass_items(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    if (pass.status === "posted") return ok(pass);
    if (pass.status !== "awaiting_approval") {
      return fail(`Only a pass awaiting approval can be approved (status: ${pass.status})`);
    }
    const items = (pass.gate_pass_items ?? []) as {
      product_id: string;
      net_weight_kg: number;
      party_id: string | null;
    }[];
    if (!items.length) return fail("Cannot approve a gate pass with no items");
    const guardError = await guardStock(supabase, pass, items);
    if (guardError) return fail(guardError);
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "gate_passes",
      voucherId: id,
      fromStatuses: ["awaiting_approval"],
      toStatus: "posted",
      voucherType: "gatepass",
      voucherNo: pass.pass_no,
      entryKind: "post",
      lines: items.map((item, i) => ({
        lineNo: i,
        godownId: pass.godown_id,
        productId: item.product_id,
        partyId: item.party_id ?? null,
        inwardQty: 0,
        outwardQty: roundWeight(item.net_weight_kg),
      })),
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "gatepass:approve",
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a pass awaiting approval can be approved (status: ${transition.result.status})`);
    }
    const posted = transition.result.voucher as Record<string, unknown>;
    const result: Record<string, unknown> = { ...posted, items };
    await supabase
      .from("gate_passes")
      .update({ approved_by: actorName(gate.actor), updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "posted");
    result.approved_by = actorName(gate.actor);
    await logAudit(supabase, {
      action: "approve",
      entityType: "gate_passes",
      entityId: id,
      voucherNo: pass.pass_no,
      before: { status: "awaiting_approval" },
      after: { status: "posted" },
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    revalidateGatepass();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

/**
 * Reject an awaiting_approval pass back to draft with a mandatory
 * reason (stored as rejection_reason). No stock ever moved for it,
 * so rejection changes no ledger rows; the pass can be edited and
 * re-submitted. Same interim owner_admin gate as approval.
 */
export async function rejectGatePass(id: string, reason: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A rejection reason is mandatory");
    const supabase = await createClient();
    const gate = await requireRole(supabase, OWNER_ONLY);
    if (!gate.ok) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "gatepass:reject", clientToken);
    if (replay) return replay;
    const { data: pass, error } = await supabase
      .from("gate_passes")
      .select("*, gate_pass_items(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    if (pass.status === "draft") return ok(pass);
    if (pass.status !== "awaiting_approval") {
      return fail(`Only a pass awaiting approval can be rejected (status: ${pass.status})`);
    }
    const { data: rejected, error: uError } = await supabase
      .from("gate_passes")
      .update({ status: "draft", rejection_reason: reason.trim(), approved_by: null, updated_by: gate.actor.userId })
      .eq("id", id)
      .in("status", ["awaiting_approval"])
      .select()
      .single();
    if (uError) return fail(uError.message);
    const result = { ...rejected, items: pass.gate_pass_items ?? [] };
    await logAudit(supabase, {
      action: "reject",
      entityType: "gate_passes",
      entityId: id,
      voucherNo: pass.pass_no,
      before: { status: "awaiting_approval" },
      after: { status: "draft" },
      reason: reason.trim(),
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    await storeIdempotency(supabase, "gatepass:reject", clientToken, "gatepass", id, pass.pass_no, result);
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
    // Already reversed is a successful replay, not a second reversal.
    if (pass.status === "reversed") return ok(pass);
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
    // remainder, never the full dispatched quantity again. The
    // remainder is dispatched minus ALL returned quantity (accepted +
    // rejected): rejected goods are accounted for, not in stock, so
    // restoring them would wrongly credit stock that was rejected.
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
    // Atomic reversal (B4): mirror rows + status flip + idempotency
    // key in one transaction via atomic_stock_transition.
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "gate_passes",
      voucherId: id,
      fromStatuses: ["posted", "partially_returned"],
      toStatus: "reversed",
      voucherType: "gatepass",
      voucherNo: pass.pass_no,
      entryKind: "reversal",
      lines: toRestore.map((item, i) => ({
        lineNo: i,
        godownId: pass.godown_id,
        productId: item.productId,
        partyId: item.partyId,
        inwardQty: roundWeight(item.qtyKg),
        outwardQty: 0,
        notes: `Reversal of ${pass.pass_no}: ${reason.trim()}`,
      })),
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "gatepass:reverse",
      reversalReason: reason.trim(),
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a posted or partially returned gate pass can be reversed (status: ${transition.result.status})`);
    }
    const reversed = transition.result.voucher as Record<string, unknown>;
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
    /** Condition of the returned goods (free text, e.g. "damaged"); applies to whole-return lines when items are omitted. */
    condition?: string;
    /** Restock decision for whole-return lines when items are omitted; defaults to 'accepted'. */
    restockDecision?: "accepted" | "rejected";
    /** If omitted, the whole remaining (not yet returned) quantity is returned. Quantities are kg. */
    items?: {
      productId: string;
      qtyKg: number;
      partyId?: string | null;
      /** Condition of this line's returned goods. */
      condition?: string;
      /** 'accepted' restocks the quantity, 'rejected' records it without returning it to stock. Defaults to 'accepted'. */
      restockDecision?: "accepted" | "rejected";
    }[];
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
    // Per-line condition/decision, carried alongside the quantities so
    // the return rows and the ledger split stay in the same shape.
    let returnLines: { productId: string; qtyKg: number; partyId: string | null; condition: string | null; restockDecision: "accepted" | "rejected" }[];
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
        if (r.restockDecision !== undefined && r.restockDecision !== "accepted" && r.restockDecision !== "rejected") {
          throw new Error(`Return for product ${r.productId} has an invalid restock decision`);
        }
        return {
          productId: r.productId,
          qtyKg: roundWeight(r.qtyKg),
          partyId: r.partyId !== undefined ? r.partyId : (owners[0] ?? null),
          condition: r.condition?.trim() || null,
          restockDecision: r.restockDecision ?? ("accepted" as const),
        };
      });
      const checked = validateCumulativeReturns(dispatchedPools, priorPools, resolved);
      if (!checked.ok) return fail(checked.error);
      returns = checked.aggregated;
      returnLines = resolved;
    } else {
      returns = remainingReturnable(dispatchedPools, priorPools);
      if (!returns.length) return fail(`Gate pass ${pass.pass_no} has nothing left to return`);
      returnLines = returns.map((r) => ({
        ...r,
        condition: input.condition?.trim() || null,
        restockDecision: input.restockDecision ?? ("accepted" as const),
      }));
    }
    const dispatchedTotal = roundWeight(dispatchedPools.reduce((s, d) => s + d.qtyKg, 0));
    const priorTotal = roundWeight(priorPools.reduce((s, d) => s + d.qtyKg, 0));
    const newTotal = roundWeight(priorTotal + returns.reduce((s, r) => s + r.qtyKg, 0));
    const newStatus = gatePassStatusAfterReturn(dispatchedTotal, newTotal);
    // Return records FIRST, with their insert error checked: a failed
    // insert aborts the return before any ledger row or status flip, so
    // the pass can never flip to returned with no audit record.
    // NOTE on rejected quantity: status and cumulative math count ALL
    // returned quantity (accepted + rejected) — rejected goods are
    // accounted for, just not back in stock — while the LEDGER below
    // credits only accepted quantity. That keeps reversal honest too:
    // it restores dispatched minus all returned, never rejected stock.
    const { data: inserted, error: insertError } = await supabase
      .from("gate_pass_returns")
      .insert(
        returnLines.map((ret) => ({
          gate_pass_id: pass.id,
          product_id: ret.productId,
          party_id: ret.partyId,
          qty_kg: roundWeight(ret.qtyKg),
          reason: input.reason.trim(),
          condition: ret.condition,
          restock_decision: ret.restockDecision,
        })),
      )
      .select("id");
    if (insertError) return fail(insertError.message);
    const by = gate.actor.userId;
    // Return-line identity: a pass can be returned more than once, so
    // line numbers continue from the count of return rows already on
    // the ledger — a second return never reuses a first return's
    // (entry_kind, line_no). Two returns racing on the same base
    // collide on the unique index instead of duplicating: the loser
    // fails, and its retry recomputes the base and succeeds.
    const { data: priorReturnLedger } = await supabase
      .from("stock_ledger")
      .select("id")
      .eq("voucher_type", "gatepass")
      .eq("voucher_id", pass.id)
      .eq("entry_kind", "return");
    const returnLineBase = (priorReturnLedger ?? []).length;
    try {
      // Restock ONLY the accepted quantity: rejected lines are recorded
      // above but deliberately get no ledger row, so rejected goods
      // never come back into stock.
      const restockLines = acceptedRestockQuantities(returnLines);
      for (let i = 0; i < restockLines.length; i++) {
        const ret = restockLines[i];
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
            entryKind: "return",
            lineNo: returnLineBase + i,
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
        updated_by: gate.actor.userId,
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

/** Unified init data for /gatepass page — replaces 7 client roundtrips with 1 */
export async function getGatePassInitData(): Promise<ActionResult<{
  passes: unknown[];
  godowns: unknown[];
  products: unknown[];
  parties: unknown[];
  summary: unknown[];
  packagingTypes: unknown[];
  company: unknown;
}>> {
  try {
    const [gp, g, pr, pa, sm, pk, co] = await Promise.all([
      listGatePasses(),
      listGodowns(),
      listProducts(),
      listParties(),
      getStockSummary(),
      listPackagingTypes(),
      getCompanySettings(),
    ]);
    return ok({
      passes: (Array.isArray(gp.data) ? gp.data : []) as any[],
      godowns: (Array.isArray(g.data) ? g.data : []) as any[],
      products: (Array.isArray(pr.data) ? pr.data : []) as any[],
      parties: (Array.isArray(pa.data) ? pa.data : []) as any[],
      summary: (Array.isArray(sm.data) ? sm.data : []) as any[],
      packagingTypes: (Array.isArray(pk.data) ? pk.data : []) as any[],
      company: co.data ?? null,
    });
  } catch (e) {
    return fail(errMessage(e));
  }
}
