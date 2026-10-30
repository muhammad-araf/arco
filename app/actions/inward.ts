"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireSignedIn, type Actor } from "./auth";
import { STOCK_WRITE } from "./auth-helpers";
import { logAudit } from "@/lib/audit";
import { netWeight, roundMoney, roundWeight, stockBalanceFromRows, aggregatePoolQuantities } from "@/lib/calc";
import { callAtomicStockTransition } from "@/lib/atomic";
import { normalizeBiltyMode, type BiltyDuplicateMode } from "@/lib/stock-helpers";
import { listGodowns, listProducts, listParties, listEmployees } from "./masters";
import { getCompanySettings } from "./settings";

/**
 * Inward (incoming goods) server actions.
 *
 * Flow: createInwardDraft -> postInward -> reverseInward(reason).
 * - Drafts NEVER touch stock_ledger.
 * - Posting writes one stock_ledger inward row per item, exactly once
 *   (status guard + optional clientToken idempotency key).
 * - Voucher numbers are generated server-side via the doc_numbering
 *   sequence (see supabase/schema.sql appendix); a client-supplied
 *   voucher number is never accepted.
 * - Customer-owned / consignment goods: pass isCustomerOwned + ownerPartyId.
 *   Ledger rows then carry the OWNER's party_id, so party-owned stock is
 *   tracked separately from company-owned stock (company stock = the
 *   balance of rows with the source party, filtered by owner in inventory).
 *   A service job on customer-owned material must use that party balance,
 *   never the company balance — see production.ts / gatepass.ts.
 * - Line rate_per_unit is treated as a PER-KG rate for total_value only;
 *   a zero rate means "no valuation recorded" (spec: do not invent a rate
 *   for consignment stock).
 */

type Db = Awaited<ReturnType<typeof createClient>>;
type ActionResult<T = unknown> = { success: boolean; data?: T; error?: string };

function ok<T = unknown>(data: T): ActionResult<T> {
  return { success: true, data };
}
function fail(error: string): ActionResult<never> {
  return { success: false, error };
}
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function revalidateInward(): void {
  revalidatePath("/inward");
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

/** Server-side sequential number. Falls back to a timestamp suffix only if the numbering table/RPC is not yet migrated. */
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

async function checkIdempotency(
  supabase: Db,
  scope: string,
  clientToken?: string,
): Promise<ActionResult | null> {
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

async function stockBalance(
  supabase: Db,
  godownId: string,
  productId: string,
  partyId: string | null,
): Promise<number> {
  // DB-side aggregate first (supabase/migration-stock-summary-rpc.sql):
  // one grouped sum instead of shipping the pool's whole ledger history.
  // Falls back to the ledger scan when the RPC was never applied.
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

/**
 * Opening stock recorded in opening_balances (kind "stock", existing
 * write shape: godown_id / product_id / party_id / quantity). A query
 * error degrades to 0 — the guard then falls back to the ledger-only
 * balance, which can only make the guard stricter, never looser.
 */
async function openingBalance(
  supabase: Db,
  godownId: string,
  productId: string,
  partyId: string | null,
): Promise<number> {
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
async function physicalBalance(
  supabase: Db,
  godownId: string,
  productId: string,
  partyId: string | null,
): Promise<number> {
  return roundWeight(
    (await stockBalance(supabase, godownId, productId, partyId)) +
      (await openingBalance(supabase, godownId, productId, partyId)),
  );
}

// ---------------- Reads ----------------
/** Bilty duplicate-check mode from the app_settings row owned by the
 *  settings team. Absent row, absent value, or an unrecognised value
 *  all resolve to "warn" (never hard-coded to a mode here). The raw
 *  value may be a plain string ("block") or an object ({ mode }). */
async function biltyDuplicateMode(supabase: Db): Promise<BiltyDuplicateMode> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "bilty_duplicate_check")
    .maybeSingle();
  if (error || !data) return "warn";
  return normalizeBiltyMode((data as { value?: unknown }).value);
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export async function listInward(filters?: {
  status?: string;
  godownId?: string;
  partyId?: string;
  from?: string;
  to?: string;
  /** Free-text search across voucher, bilty and vehicle numbers. */
  search?: string;
  /** 1-based page; when set, returns the paged shape (same pattern as
   *  the stock-ledger register): { rows, total, page, pageSize }. */
  page?: number;
  pageSize?: number;
}): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    // Exclusive next-day bound (same fix as the stock ledger): a plain
    // YYYY-MM-DD compares as midnight and silently dropped the `to` day.
    const toExclusive = filters?.to
      ? (() => {
          const d = new Date(`${filters.to}T00:00:00Z`);
          if (Number.isNaN(d.getTime())) return undefined;
          d.setUTCDate(d.getUTCDate() + 1);
          return d.toISOString();
        })()
      : undefined;
    const search = filters?.search?.trim();
    const searchTerm = search ? `%${escapeLike(search)}%` : undefined;
    if (filters?.page !== undefined) {
      const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);
      const page = Math.max(filters.page, 1);
      const fromRow = (page - 1) * pageSize;
      const toRow = fromRow + pageSize - 1;
      let query = supabase
        .from("incoming_goods")
        .select("*, incoming_goods_items(*)", { count: "exact" })
        .order("date", { ascending: false });
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
      if (filters?.partyId) query = query.eq("party_id", filters.partyId);
      if (filters?.from) query = query.gte("date", filters.from);
      if (toExclusive) query = query.lt("date", toExclusive);
      if (searchTerm) query = query.or(`voucher_no.ilike.${searchTerm},bilty_no.ilike.${searchTerm},vehicle_no.ilike.${searchTerm}`);
      const { data, error, count } = await query.range(fromRow, toRow);
      if (error) return fail(error.message);
      return ok({ rows: data, total: count ?? (data ?? []).length, page, pageSize });
    }
    let query = supabase
      .from("incoming_goods")
      .select("*, incoming_goods_items(*)")
      .order("date", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
    if (filters?.partyId) query = query.eq("party_id", filters.partyId);
    if (filters?.from) query = query.gte("date", filters.from);
    if (toExclusive) query = query.lt("date", toExclusive);
    if (searchTerm) query = query.or(`voucher_no.ilike.${searchTerm},bilty_no.ilike.${searchTerm},vehicle_no.ilike.${searchTerm}`);
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function getInward(id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase
      .from("incoming_goods")
      .select("*, incoming_goods_items(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Draft ----------------
export interface InwardItemInput {
  productId: string;
  bags: number;
  grossWeightKg: number;
  /** Total tare for the line (kg). If tarePerBagKg is given it wins. */
  tareWeightKg?: number;
  /** Per-bag tare (kg) for this line's bag type. */
  tarePerBagKg?: number;
  /** Optional per-kg rate; 0/absent = no valuation recorded. */
  ratePerUnit?: number;
  /** Optional lot number; empty = no lot tracking for this line. */
  lotNo?: string;
}

export async function createInwardDraft(input: {
  partyId: string;
  godownId: string;
  date?: string;
  biltyNo?: string;
  vehicleNo?: string;
  driverName?: string;
  driverPhone?: string;
  transportCompany?: string;
  notes?: string;
  /** Staff member who received the goods (free text). */
  receivedBy?: string;
  /** True when the goods were delivered by hand (no vehicle). */
  byHand?: boolean;
  /** Free-text receiving classification. No classification list is
   *  invented here — free text until the client confirms one. */
  nature?: string;
  /** Reference-only attachment link + note (never required). */
  attachmentUrl?: string;
  attachmentNote?: string;
  isCustomerOwned?: boolean;
  ownerPartyId?: string;
  items: InwardItemInput[];
}): Promise<ActionResult> {
  try {
    if (!input?.partyId || !input?.godownId) return fail("partyId and godownId are required");
    if (!input.items?.length) return fail("At least one item line is required");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    // Server-side is_active check: the UI already filters inactive
    // products, but a stale form or a direct call must never post one.
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const { data: prodRows, error: prodError } = await supabase
      .from("products")
      .select("id, is_active")
      .in("id", productIds);
    if (prodError) return fail(prodError.message);
    for (const pid of productIds) {
      const row = (prodRows ?? []).find((p: { id: string }) => p.id === pid) as
        | { is_active?: boolean }
        | undefined;
      if (!row) return fail(`Product ${pid} was not found.`);
      if (row.is_active === false) return fail("An inactive product cannot be received. Reactivate it in Masters first.");
    }
    // Bilty duplicate check, per the app_settings mode (settings team
    // owns the setting; absent = warn). "warn" proceeds and returns a
    // biltyWarning the UI displays without blocking; "block" rejects;
    // "off" skips the check entirely.
    let biltyWarning: string | undefined;
    const biltyNo = input.biltyNo?.trim() || undefined;
    if (biltyNo) {
      const mode = await biltyDuplicateMode(supabase);
      if (mode !== "off") {
        const { data: dupes, error: dupError } = await supabase
          .from("incoming_goods")
          .select("id, voucher_no")
          .eq("bilty_no", biltyNo)
          .neq("status", "reversed")
          .limit(1);
        if (dupError) return fail(dupError.message);
        if ((dupes ?? []).length > 0) {
          if (mode === "block") {
            return fail(
              `Bilty number ${biltyNo} is already used on ${(dupes as { voucher_no: string }[])[0].voucher_no}. Duplicate bilty numbers are blocked by the current setting.`,
            );
          }
          biltyWarning = `Warning: bilty number ${biltyNo} was already used on ${(dupes as { voucher_no: string }[])[0].voucher_no}.`;
        }
      }
    }
    const voucherNo = await nextDocNumber(supabase, "inward", "INW");

    const lines = input.items.map((item) => {
      if (!item.productId) throw new Error("Every item needs a productId");
      if (item.bags < 0 || item.grossWeightKg <= 0) {
        throw new Error("Item bags must be >= 0 and gross weight must be > 0");
      }
      const tareTotal =
        item.tarePerBagKg !== undefined && item.tarePerBagKg !== null
          ? roundWeight(item.bags * item.tarePerBagKg)
          : roundWeight(item.tareWeightKg ?? 0);
      const net =
        item.tarePerBagKg !== undefined && item.tarePerBagKg !== null
          ? netWeight(item.grossWeightKg, item.bags, item.tarePerBagKg)
          : roundWeight(item.grossWeightKg - tareTotal);
      if (net < 0) throw new Error("Item net weight would be negative");
      const rate = item.ratePerUnit ?? 0;
      return {
        product_id: item.productId,
        bags_count: item.bags,
        gross_weight_kg: roundWeight(item.grossWeightKg),
        tare_weight_kg: tareTotal,
        net_weight_kg: net,
        rate_per_unit: rate,
        total_value: roundMoney(rate * net),
        lot_no: item.lotNo?.trim() ? item.lotNo.trim() : null,
      };
    });
    const totalBags = lines.reduce((s, l) => s + l.bags_count, 0);
    const totalNet = roundWeight(lines.reduce((s, l) => s + l.net_weight_kg, 0));
    const totalValue = roundMoney(lines.reduce((s, l) => s + l.total_value, 0));

    // New header columns (received_by / by_hand / nature) and the
    // line lot_no column need a live-DB migration (see the STOCK-DASH
    // report). Until it is applied, degrade instead of breaking
    // inward entirely: retry without the missing columns and surface
    // the loss as a warning on the returned draft.
    const isMissingColumn = (msg: string) => /column .* does not exist/i.test(msg);
    let columnsWarning: string | undefined;
    const headerRow = {
      voucher_no: voucherNo,
      date: input.date ?? new Date().toISOString(),
      party_id: input.partyId,
      godown_id: input.godownId,
      bilty_no: biltyNo ?? null,
      vehicle_no: input.vehicleNo ?? null,
      driver_name: input.driverName ?? null,
      driver_phone: input.driverPhone ?? null,
      transport_company: input.transportCompany ?? null,
      status: "draft",
      total_bags: totalBags,
      total_net_weight_kg: totalNet,
      total_value: totalValue,
      notes: input.notes ?? null,
      is_customer_owned: input.isCustomerOwned ?? false,
      owner_party_id: input.ownerPartyId ?? null,
      received_by: input.receivedBy?.trim() ? input.receivedBy.trim() : null,
      by_hand: input.byHand ?? false,
      nature: input.nature?.trim() ? input.nature.trim() : null,
      created_by: gate.actor.userId,
      attachment_url: input.attachmentUrl?.trim() ? input.attachmentUrl.trim() : null,
      attachment_note: input.attachmentNote?.trim() ? input.attachmentNote.trim() : null,
    };
    let headerRes = await supabase.from("incoming_goods").insert(headerRow).select().single();
    if (headerRes.error && isMissingColumn(headerRes.error.message)) {
      const { received_by: _rb, by_hand: _bh, nature: _n, attachment_url: _au, attachment_note: _an, created_by: _cb, ...legacyRow } = headerRow;
      void _rb;
      void _bh;
      void _n;
      void _au;
      void _an;
      void _cb;
      headerRes = await supabase.from("incoming_goods").insert(legacyRow).select().single();
      if (!headerRes.error) {
        columnsWarning =
          "Received-by / by-hand / nature were not saved: the live database does not have those columns yet (migration pending).";
      }
    }
    const { data: header, error: hError } = headerRes;
    if (hError) return fail(hError.message);

    let iRes = await supabase
      .from("incoming_goods_items")
      .insert(lines.map((l) => ({ ...l, incoming_id: header.id })));
    if (iRes.error && isMissingColumn(iRes.error.message)) {
      const legacyLines = lines.map((l) => {
        const { lot_no: _lot, ...rest } = l;
        void _lot;
        return { ...rest, incoming_id: header.id };
      });
      iRes = await supabase.from("incoming_goods_items").insert(legacyLines);
      if (!iRes.error && !columnsWarning) {
        columnsWarning = "Lot numbers were not saved: the live database does not have the lot column yet (migration pending).";
      } else if (!iRes.error) {
        columnsWarning += " Lot numbers were also not saved.";
      }
    }
    const { error: iError } = iRes;
    if (iError) {
      // Draft header without lines is useless; remove it (drafts are not ledger history).
      await supabase.from("incoming_goods").delete().eq("id", header.id);
      return fail(iError.message);
    }
    revalidateInward();
    return ok({ ...header, items: lines, biltyWarning, columnsWarning });
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Post ----------------
export async function postInward(id: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "inward:post", clientToken);
    if (replay) return replay;

    const { data: voucher, error: vError } = await supabase
      .from("incoming_goods")
      .select("*, incoming_goods_items(*)")
      .eq("id", id)
      .single();
    if (vError) return fail(vError.message);
    // Already posted is a successful replay, not an error: the post
    // did happen, and re-posting must never write a second set of rows.
    if (voucher.status === "posted") return ok(voucher);
    if (voucher.status !== "draft") return fail(`Only a draft can be posted (status: ${voucher.status})`);

    // Owner tracking (stock_ledger.party_id = STOCK OWNER, not supplier):
    // company-owned inward -> party_id NULL; customer-owned -> owner party.
    const ledgerPartyId: string | null =
      voucher.is_customer_owned && voucher.owner_party_id
        ? voucher.owner_party_id
        : null; // company-owned pool (party_id NULL); supplier stays on header
    const items = (voucher.incoming_goods_items ?? []) as {
      product_id: string;
      net_weight_kg: number;
      lot_no?: string | null;
    }[];
    if (!items.length) return fail("Cannot post an inward voucher with no items");
    // Atomic post (B4): the function locks the voucher row, inserts
    // every ledger line, flips the status, and stores the idempotency
    // key in ONE transaction. A concurrent post blocks on the lock
    // and then replays ('already'); a crash rolls everything back,
    // so a retry starts clean. Never fall back to a manual loop here.
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "incoming_goods",
      voucherId: id,
      fromStatuses: ["draft"],
      toStatus: "posted",
      voucherType: "inward",
      voucherNo: voucher.voucher_no,
      entryKind: "post",
      lines: items.map((item, i) => ({
        lineNo: i,
        godownId: voucher.godown_id,
        productId: item.product_id,
        partyId: ledgerPartyId,
        inwardQty: roundWeight(item.net_weight_kg),
        outwardQty: 0,
        lotNumber: item.lot_no ?? null,
      })),
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "inward:post",
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a draft can be posted (status: ${transition.result.status})`);
    }
    const posted = transition.result.voucher as Record<string, unknown>;
    const result = { ...posted, items };
    await logAudit(supabase, {
      action: "post",
      entityType: "incoming_goods",
      entityId: id,
      voucherNo: voucher.voucher_no,
      before: { status: "draft" },
      after: { status: "posted" },
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    revalidateInward();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Reverse ----------------
export async function reverseInward(
  id: string,
  reason: string,
  clientToken?: string,
): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A reversal reason is mandatory");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "inward:reverse", clientToken);
    if (replay) return replay;

    const { data: voucher, error: vError } = await supabase
      .from("incoming_goods")
      .select("*, incoming_goods_items(*)")
      .eq("id", id)
      .single();
    if (vError) return fail(vError.message);
    // Already reversed is a successful replay, not a second reversal.
    if (voucher.status === "reversed") return ok(voucher);
    if (voucher.status !== "posted") {
      return fail(`Only a posted inward can be reversed (status: ${voucher.status})`);
    }
    const ledgerPartyId: string | null =
      voucher.is_customer_owned && voucher.owner_party_id
        ? voucher.owner_party_id
        : null; // company-owned pool (party_id NULL); supplier stays on header
    const items = (voucher.incoming_goods_items ?? []) as {
      product_id: string;
      net_weight_kg: number;
      lot_no?: string | null;
    }[];
    // Stock guard on reversal: undoing an inward must not drive stock negative
    // (later consumption/dispatch may already have used this stock).
    // Aggregate duplicate lines per (product, owner) BEFORE guarding,
    // mirroring postGatePass: two 60 kg lines against a 90 kg balance
    // must fail as 120 kg, not pass twice as 60 kg.
    const required = aggregatePoolQuantities(
      items.map((item) => ({
        productId: item.product_id,
        partyId: ledgerPartyId,
        qtyKg: roundWeight(item.net_weight_kg),
      })),
    );
    for (const { productId, partyId, qtyKg } of required) {
      const balance = await physicalBalance(supabase, voucher.godown_id, productId, partyId);
      if (balance < qtyKg) {
        return fail(
          `Cannot reverse ${voucher.voucher_no}: available stock for this product is ${balance} kg, but reversal needs ${qtyKg} kg (stock was already consumed/dispatched)`,
        );
      }
    }
    // Atomic reversal (B4): mirror rows + status flip + idempotency
    // key in one transaction via atomic_stock_transition (see post).
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "incoming_goods",
      voucherId: id,
      fromStatuses: ["posted"],
      toStatus: "reversed",
      voucherType: "inward",
      voucherNo: voucher.voucher_no,
      entryKind: "reversal",
      lines: items.map((item, i) => ({
        lineNo: i,
        godownId: voucher.godown_id,
        productId: item.product_id,
        partyId: ledgerPartyId,
        inwardQty: 0,
        outwardQty: roundWeight(item.net_weight_kg),
        notes: `Reversal of ${voucher.voucher_no}: ${reason.trim()}`,
        lotNumber: item.lot_no ?? null,
      })),
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "inward:reverse",
      reversalReason: reason.trim(),
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a posted inward can be reversed (status: ${transition.result.status})`);
    }
    const reversed = transition.result.voucher as Record<string, unknown>;
    const result = { ...reversed, items };
    await logAudit(supabase, {
      action: "reverse",
      entityType: "incoming_goods",
      entityId: id,
      voucherNo: voucher.voucher_no,
      before: { status: "posted" },
      after: { status: "reversed" },
      reason: reason.trim(),
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    revalidateInward();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

/** Single unified load for /inward page — eliminates 6 client roundtrips */
export async function getInwardInitData(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  from?: string;
  to?: string;
}): Promise<ActionResult<{
  vouchers: unknown;
  godowns: unknown[];
  products: unknown[];
  parties: unknown[];
  company: unknown;
  employees: unknown[];
}>> {
  try {
    const [v, g, pr, pa, co, em] = await Promise.all([
      listInward(params),
      listGodowns(),
      listProducts(),
      listParties(),
      getCompanySettings(),
      listEmployees(),
    ]);
    return ok({
      vouchers: v.data,
      godowns: (Array.isArray(g.data) ? g.data : []) as any[],
      products: (Array.isArray(pr.data) ? pr.data : []) as any[],
      parties: (Array.isArray(pa.data) ? pa.data : []) as any[],
      company: co.data ?? null,
      employees: (Array.isArray(em.data) ? em.data : []) as any[],
    });
  } catch (e) {
    return fail(errMessage(e));
  }
}
