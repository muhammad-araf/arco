"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireSignedIn, type Actor } from "./auth";
import { STOCK_WRITE } from "./auth-helpers";
import { logAudit } from "@/lib/audit";
import { roundWeight, stockBalanceFromRows } from "@/lib/calc";
import { callAtomicStockTransition } from "@/lib/atomic";
import { fifoAgeing } from "@/lib/stock-helpers";

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

async function stockBalance(
  supabase: Db,
  godownId: string,
  productId: string,
  partyId: string | null,
): Promise<number> {
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

/** Merge opening_balances rows of kind "stock" into a summary key map. */
async function applyOpeningBalances(
  supabase: Db,
  byKey: Map<string, { godown_id: string; product_id: string; party_id: string | null; balance: number }>,
): Promise<void> {
  // Existing write shape (finance.ts createOpeningBalance): balance_kind,
  // godown_id, product_id, party_id, quantity. Read shape unchanged.
  // A query error degrades to no openings (previous behaviour) rather
  // than failing the whole summary.
  const { data, error } = await supabase
    .from("opening_balances")
    .select("godown_id, product_id, party_id, quantity")
    .eq("balance_kind", "stock");
  if (error) return;
  for (const row of (data ?? []) as {
    godown_id: string;
    product_id: string;
    party_id: string | null;
    quantity: number;
  }[]) {
    if (!row.godown_id || !row.product_id) continue;
    const key = `${row.godown_id}|${row.product_id}|${row.party_id ?? ""}`;
    const entry = byKey.get(key) ?? {
      godown_id: row.godown_id,
      product_id: row.product_id,
      party_id: row.party_id,
      balance: 0,
    };
    entry.balance = roundWeight(entry.balance + (Number(row.quantity) || 0));
    byKey.set(key, entry);
  }
}

// ---------------- Reads ----------------
/** Balances computed from stock_ledger rows, grouped by godown x product x owner party. */
export async function getStockSummary(): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    // Prefer the DB-side aggregate (supabase/migration-stock-summary-rpc.sql):
    // one grouped sum instead of shipping the whole ledger to aggregate here.
    // The RPC is result-identical to the JS path below because every ledger
    // writer rounds quantities to 2dp on write, so a final 2dp rounding of
    // the exact decimal sum equals the old per-row rounded accumulation.
    // If the migration was never applied, the RPC errors and we fall back
    // to the JS aggregation — the app keeps working either way.
    const [rpc, godowns, products, parties] = await Promise.all([
      supabase.rpc("stock_summary"),
      supabase.from("godowns").select("id, name"),
      supabase.from("products").select("id, name, min_stock, category"),
      supabase.from("parties").select("id, name"),
    ]);
    const godownName = new Map((godowns.data ?? []).map((g: { id: string; name: string }) => [g.id, g.name]));
    const productInfo = new Map(
      (products.data ?? []).map((p: { id: string; name: string; min_stock: number; category?: string }) => [p.id, p]),
    );
    const partyName = new Map((parties.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
    const byKey = new Map<
      string,
      { godown_id: string; product_id: string; party_id: string | null; balance: number }
    >();
    if (!rpc.error && Array.isArray(rpc.data)) {
      for (const row of rpc.data as {
        godown_id: string;
        product_id: string;
        party_id: string | null;
        balance_kg: number;
      }[]) {
        byKey.set(`${row.godown_id}|${row.product_id}|${row.party_id ?? ""}`, {
          godown_id: row.godown_id,
          product_id: row.product_id,
          party_id: row.party_id,
          balance: roundWeight(Number(row.balance_kg) || 0),
        });
      }
    } else {
      const ledger = await supabase
        .from("stock_ledger")
        .select("godown_id, product_id, party_id, inward_qty, outward_qty");
      if (ledger.error) return fail(ledger.error.message);
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
    }
    // Migration openings reach stock here, on both paths: rows of kind
    // "stock" add their quantity to their (godown, product, owner) pool.
    // Note for live verification: if an opening is ALSO posted as ledger
    // rows, it would double-count — the migration flow must write it in
    // exactly one place (see final report).
    await applyOpeningBalances(supabase, byKey);
    const summary = [...byKey.values()].map((e) => {
      const minStock = productInfo.get(e.product_id)?.min_stock ?? 0;
      return {
        godown_id: e.godown_id,
        godown_name: godownName.get(e.godown_id) ?? e.godown_id,
        product_id: e.product_id,
        product_name: productInfo.get(e.product_id)?.name ?? e.product_id,
        // Category is resolved server-side here (the page used to join
        // it client-side from the masters list).
        product_category: productInfo.get(e.product_id)?.category ?? null,
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

/** Unified fast loader for the stock page: fetches summary, godowns, products, and parties in one round trip. */
export async function getInventoryInitData(): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);

    const [rpc, godowns, products, parties] = await Promise.all([
      supabase.rpc("stock_summary"),
      supabase.from("godowns").select("*").eq("is_active", true).order("code"),
      supabase.from("products").select("*").eq("is_active", true).order("code"),
      supabase.from("parties").select("*").eq("is_active", true).order("code"),
    ]);

    const godownName = new Map((godowns.data ?? []).map((g: { id: string; name: string }) => [g.id, g.name]));
    const productInfo = new Map(
      (products.data ?? []).map((p: { id: string; name: string; min_stock: number; category?: string }) => [p.id, p]),
    );
    const partyName = new Map((parties.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
    const byKey = new Map<
      string,
      { godown_id: string; product_id: string; party_id: string | null; balance: number }
    >();
    if (!rpc.error && Array.isArray(rpc.data)) {
      for (const row of rpc.data as {
        godown_id: string;
        product_id: string;
        party_id: string | null;
        balance_kg: number;
      }[]) {
        byKey.set(`${row.godown_id}|${row.product_id}|${row.party_id ?? ""}`, {
          godown_id: row.godown_id,
          product_id: row.product_id,
          party_id: row.party_id,
          balance: roundWeight(Number(row.balance_kg) || 0),
        });
      }
    } else {
      const ledger = await supabase
        .from("stock_ledger")
        .select("godown_id, product_id, party_id, inward_qty, outward_qty");
      if (ledger.error) return fail(ledger.error.message);
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
    }
    await applyOpeningBalances(supabase, byKey);
    const summary = [...byKey.values()].map((e) => {
      const minStock = productInfo.get(e.product_id)?.min_stock ?? 0;
      return {
        godown_id: e.godown_id,
        godown_name: godownName.get(e.godown_id) ?? e.godown_id,
        product_id: e.product_id,
        product_name: productInfo.get(e.product_id)?.name ?? e.product_id,
        product_category: productInfo.get(e.product_id)?.category ?? null,
        party_id: e.party_id,
        party_name: e.party_id ? (partyName.get(e.party_id) ?? e.party_id) : null,
        balance_kg: e.balance,
        unit: "kg",
        min_stock_kg: minStock,
        below_min_stock: e.balance < minStock,
      };
    });
    return ok({
      summary,
      godowns: godowns.data ?? [],
      products: products.data ?? [],
      parties: parties.data ?? [],
    });
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function getStockLedger(filters?: {
  godownId?: string;
  productId?: string;
  partyId?: string;
  voucherNo?: string;
  /** Optional lot number filter (lot traceability). */
  lotNumber?: string;
  from?: string;
  to?: string;
  limit?: number;
  /** 1-based page; pageSize defaults to 50. */
  page?: number;
  pageSize?: number;
}): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);
    const page = Math.max(filters?.page ?? 1, 1);
    const fromRow = (page - 1) * pageSize;
    const toRow = fromRow + pageSize - 1;
    // The `to` bound is end-of-day, not midnight: a plain YYYY-MM-DD
    // compares as midnight, which silently dropped the whole `to` day.
    // Using an exclusive next-day bound includes every row dated `to`.
    const toExclusive = filters?.to
      ? (() => {
          const d = new Date(`${filters.to}T00:00:00Z`);
          if (Number.isNaN(d.getTime())) return undefined;
          d.setUTCDate(d.getUTCDate() + 1);
          return d.toISOString();
        })()
      : undefined;
    if (filters?.page !== undefined) {
      // Paged shape for the inventory register: { rows, total, page, pageSize }.
      let query = supabase
        .from("stock_ledger")
        .select("*", { count: "exact" })
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });
      if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
      if (filters?.productId) query = query.eq("product_id", filters.productId);
      if (filters?.partyId) query = query.eq("party_id", filters.partyId);
      if (filters?.voucherNo) query = query.eq("voucher_no", filters.voucherNo);
      if (filters?.lotNumber) query = query.eq("lot_number", filters.lotNumber);
      if (filters?.from) query = query.gte("date", filters.from);
      if (toExclusive) query = query.lt("date", toExclusive);
      const { data, error, count } = await query.range(fromRow, toRow);
      if (error) return fail(error.message);
      return ok({ rows: data, total: count ?? (data ?? []).length, page, pageSize });
    }
    // Legacy array shape for existing callers (dashboard, reports,
    // masters) that pass limit or no page: unchanged except the fixed
    // `to` bound above.
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
    if (filters?.lotNumber) query = query.eq("lot_number", filters.lotNumber);
    if (filters?.from) query = query.gte("date", filters.from);
    if (toExclusive) query = query.lt("date", toExclusive);
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

/**
 * FIFO stock ageing per (godown, product, owner) pool, from ledger
 * dates. APPROXIMATION, documented on the inventory tab: ledger rows
 * are consumed oldest-first; opening_balances rows carry no ledger
 * date and are excluded; buckets are the standard 0–30 / 31–60 /
 * 61–90 / 90+ day buckets pending client confirmation of the bucket
 * edges. Rows dated after today are ignored.
 */
export async function getStockAgeing(): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("stock_ledger")
      .select("godown_id, product_id, party_id, date, inward_qty, outward_qty")
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return fail(error.message);
    const pools = fifoAgeing((data ?? []) as { godown_id: string; product_id: string; party_id: string | null; date: string; inward_qty: number; outward_qty: number }[], today);
    const [godowns, products, parties] = await Promise.all([
      supabase.from("godowns").select("id, name"),
      supabase.from("products").select("id, name"),
      supabase.from("parties").select("id, name"),
    ]);
    const godownName = new Map((godowns.data ?? []).map((g: { id: string; name: string }) => [g.id, g.name]));
    const productName = new Map((products.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
    const partyName = new Map((parties.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
    return ok(
      pools.map((pool) => ({
        ...pool,
        godown_name: godownName.get(pool.godown_id) ?? pool.godown_id,
        product_name: productName.get(pool.product_id) ?? pool.product_id,
        party_name: pool.party_id ? (partyName.get(pool.party_id) ?? pool.party_id) : null,
      })),
    );
  } catch (e) {
    return fail(errMessage(e));
  }
}

/** Transfer register (read-only list; writes stay behind STOCK_WRITE). */
export async function listTransfers(filters?: {
  status?: string;
  fromGodownId?: string;
  productId?: string;
  /** 1-based page; when set, returns { rows, total, page, pageSize } (same paged pattern as the stock ledger). */
  page?: number;
  pageSize?: number;
}): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    if (filters?.page !== undefined) {
      const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);
      const page = Math.max(filters.page, 1);
      const fromRow = (page - 1) * pageSize;
      const toRow = fromRow + pageSize - 1;
      let query = supabase.from("godown_transfers").select("*", { count: "exact" }).order("date", { ascending: false });
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.fromGodownId) query = query.eq("from_godown_id", filters.fromGodownId);
      if (filters?.productId) query = query.eq("product_id", filters.productId);
      const { data, error, count } = await query.range(fromRow, toRow);
      if (error) return fail(error.message);
      return ok({ rows: data, total: count ?? (data ?? []).length, page, pageSize });
    }
    let query = supabase.from("godown_transfers").select("*").order("date", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.fromGodownId) query = query.eq("from_godown_id", filters.fromGodownId);
    if (filters?.productId) query = query.eq("product_id", filters.productId);
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

/** Adjustment history (read-only list; writes stay behind STOCK_WRITE). */
export async function listAdjustments(filters?: {
  status?: string;
  godownId?: string;
  productId?: string;
  /** 1-based page; when set, returns { rows, total, page, pageSize } (same paged pattern as the stock ledger). */
  page?: number;
  pageSize?: number;
}): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    if (filters?.page !== undefined) {
      const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);
      const page = Math.max(filters.page, 1);
      const fromRow = (page - 1) * pageSize;
      const toRow = fromRow + pageSize - 1;
      let query = supabase.from("stock_adjustments").select("*", { count: "exact" }).order("date", { ascending: false });
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
      if (filters?.productId) query = query.eq("product_id", filters.productId);
      const { data, error, count } = await query.range(fromRow, toRow);
      if (error) return fail(error.message);
      return ok({ rows: data, total: count ?? (data ?? []).length, page, pageSize });
    }
    let query = supabase.from("stock_adjustments").select("*").order("date", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
    if (filters?.productId) query = query.eq("product_id", filters.productId);
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
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
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
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "transfer:post", clientToken);
    if (replay) return replay;
    const { data: transfer, error } = await supabase
      .from("godown_transfers")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    // Already posted is a successful replay, not a second transfer.
    if (transfer.status === "posted") return ok(transfer);
    if (transfer.status !== "draft") return fail(`Only a draft can be posted (status: ${transfer.status})`);
    const qty = roundWeight(transfer.quantity);
    // Stock guard on the source godown (party-scoped when an owner is set).
    const available = await physicalBalance(supabase, transfer.from_godown_id, transfer.product_id, transfer.party_id ?? null);
    if (available < qty) {
      return fail(
        `Insufficient stock for transfer ${transfer.transfer_no}: available ${available} kg in source godown, requested ${qty} kg`,
      );
    }
    // Atomic post (B4): both legs + status flip + idempotency key in
    // one transaction via atomic_stock_transition (see inward.ts).
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "godown_transfers",
      voucherId: id,
      fromStatuses: ["draft"],
      toStatus: "posted",
      voucherType: "transfer",
      voucherNo: transfer.transfer_no,
      entryKind: "post",
      lines: [
        {
          lineNo: 0,
          godownId: transfer.from_godown_id,
          productId: transfer.product_id,
          partyId: transfer.party_id ?? null,
          inwardQty: 0,
          outwardQty: qty,
          notes: `Transfer out to godown ${transfer.to_godown_id}: ${transfer.reason ?? ""}`.trim(),
        },
        {
          lineNo: 1,
          godownId: transfer.to_godown_id,
          productId: transfer.product_id,
          partyId: transfer.party_id ?? null,
          inwardQty: qty,
          outwardQty: 0,
          notes: `Transfer in from godown ${transfer.from_godown_id}: ${transfer.reason ?? ""}`.trim(),
        },
      ],
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "transfer:post",
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a draft can be posted (status: ${transition.result.status})`);
    }
    const posted = transition.result.voucher as Record<string, unknown>;
    await logAudit(supabase, {
      action: "post",
      entityType: "godown_transfers",
      entityId: id,
      voucherNo: transfer.transfer_no,
      before: { status: "draft" },
      after: { status: "posted" },
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
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
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "transfer:reverse", clientToken);
    if (replay) return replay;
    const { data: transfer, error } = await supabase
      .from("godown_transfers")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    // Already reversed is a successful replay, not a second reversal.
    if (transfer.status === "reversed") return ok(transfer);
    if (transfer.status !== "posted") {
      return fail(`Only a posted transfer can be reversed (status: ${transfer.status})`);
    }
    const qty = roundWeight(transfer.quantity);
    const available = await physicalBalance(supabase, transfer.to_godown_id, transfer.product_id, transfer.party_id ?? null);
    if (available < qty) {
      return fail(
        `Cannot reverse transfer ${transfer.transfer_no}: destination godown holds only ${available} kg, reversal needs ${qty} kg`,
      );
    }
    // Atomic reversal (B4): both mirror legs + flip + key, one transaction.
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "godown_transfers",
      voucherId: id,
      fromStatuses: ["posted"],
      toStatus: "reversed",
      voucherType: "transfer",
      voucherNo: transfer.transfer_no,
      entryKind: "reversal",
      lines: [
        {
          lineNo: 0,
          godownId: transfer.to_godown_id,
          productId: transfer.product_id,
          partyId: transfer.party_id ?? null,
          inwardQty: 0,
          outwardQty: qty,
          notes: `Reversal of ${transfer.transfer_no}: ${reason.trim()}`,
        },
        {
          lineNo: 1,
          godownId: transfer.from_godown_id,
          productId: transfer.product_id,
          partyId: transfer.party_id ?? null,
          inwardQty: qty,
          outwardQty: 0,
          notes: `Reversal of ${transfer.transfer_no}: ${reason.trim()}`,
        },
      ],
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "transfer:reverse",
      reversalReason: reason.trim(),
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a posted transfer can be reversed (status: ${transition.result.status})`);
    }
    const reversed = transition.result.voucher as Record<string, unknown>;
    await logAudit(supabase, {
      action: "reverse",
      entityType: "godown_transfers",
      entityId: id,
      voucherNo: transfer.transfer_no,
      before: { status: "posted" },
      after: { status: "reversed" },
      reason: reason.trim(),
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
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
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const live = await physicalBalance(supabase, input.godownId, input.productId, input.partyId ?? null);
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
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "adjustment:post", clientToken);
    if (replay) return replay;
    const { data: adj, error } = await supabase.from("stock_adjustments").select("*").eq("id", id).single();
    if (error) return fail(error.message);
    // Already posted is a successful replay, not a second adjustment.
    if (adj.status === "posted") return ok(adj);
    if (adj.status !== "draft") return fail(`Only a draft can be posted (status: ${adj.status})`);
    // Re-verify "before" at posting time — stock may have moved since the draft.
    const live = await physicalBalance(supabase, adj.godown_id, adj.product_id, adj.party_id ?? null);
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
    // Atomic post (B4): ledger row + flip + key, one transaction.
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "stock_adjustments",
      voucherId: id,
      fromStatuses: ["draft"],
      toStatus: "posted",
      voucherType: "adjustment",
      voucherNo: adj.adjustment_no,
      entryKind: "post",
      lines: [
        {
          lineNo: 0,
          godownId: adj.godown_id,
          productId: adj.product_id,
          partyId: adj.party_id ?? null,
          inwardQty: delta > 0 ? delta : 0,
          outwardQty: delta < 0 ? Math.abs(delta) : 0,
          notes: `Adjustment approved by ${adj.approver}: ${adj.reason}`,
        },
      ],
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "adjustment:post",
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a draft can be posted (status: ${transition.result.status})`);
    }
    const posted = transition.result.voucher as Record<string, unknown>;
    await logAudit(supabase, {
      action: "post",
      entityType: "stock_adjustments",
      entityId: id,
      voucherNo: adj.adjustment_no,
      before: { status: "draft" },
      after: { status: "posted" },
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
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
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "adjustment:reverse", clientToken);
    if (replay) return replay;
    const { data: adj, error } = await supabase.from("stock_adjustments").select("*").eq("id", id).single();
    if (error) return fail(error.message);
    // Already reversed is a successful replay, not a second reversal.
    if (adj.status === "reversed") return ok(adj);
    if (adj.status !== "posted") {
      return fail(`Only a posted adjustment can be reversed (status: ${adj.status})`);
    }
    const delta = roundWeight(adj.delta_qty);
    if (delta > 0) {
      const live = await physicalBalance(supabase, adj.godown_id, adj.product_id, adj.party_id ?? null);
      if (live < delta) {
        return fail(`Cannot reverse adjustment ${adj.adjustment_no}: available stock is ${live} kg, reversal removes ${delta} kg`);
      }
    }
    // Atomic reversal (B4): mirror row + flip + key, one transaction.
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "stock_adjustments",
      voucherId: id,
      fromStatuses: ["posted"],
      toStatus: "reversed",
      voucherType: "adjustment",
      voucherNo: adj.adjustment_no,
      entryKind: "reversal",
      lines: [
        {
          lineNo: 0,
          godownId: adj.godown_id,
          productId: adj.product_id,
          partyId: adj.party_id ?? null,
          inwardQty: delta < 0 ? Math.abs(delta) : 0,
          outwardQty: delta > 0 ? delta : 0,
          notes: `Reversal of ${adj.adjustment_no}: ${reason.trim()}`,
        },
      ],
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "adjustment:reverse",
      reversalReason: reason.trim(),
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a posted adjustment can be reversed (status: ${transition.result.status})`);
    }
    const reversed = transition.result.voucher as Record<string, unknown>;
    await logAudit(supabase, {
      action: "reverse",
      entityType: "stock_adjustments",
      entityId: id,
      voucherNo: adj.adjustment_no,
      before: { status: "posted" },
      after: { status: "reversed" },
      reason: reason.trim(),
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    revalidateInventory();
    return ok(reversed);
  } catch (e) {
    return fail(errMessage(e));
  }
}
