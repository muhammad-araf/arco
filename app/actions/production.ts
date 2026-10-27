"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireSignedIn, type Actor } from "./auth";
import { PRODUCTION_WRITE } from "./auth-helpers";
import { logAudit } from "@/lib/audit";
import {
  checkProductsActive,
  parseVarianceTolerance,
  sumFinishedOutputs,
  varianceExceedsTolerance,
} from "./production-helpers";
import { isUniqueViolation } from "@/lib/idempotency";
import {
  writeCostLedgerRows,
  getValuationMethod,
  ingredientUnitCosts,
  type CostLedgerEntry,
} from "@/lib/cost-ledger";
import {
  roundWeight,
  roundMoney,
  ledgerRunningBalance,
  stockBalanceFromRows,
  yieldPct,
  variance,
  plannedComponentQty,
  packingCharge,
  validateMassBalance,
  aggregateQuantities,
} from "@/lib/calc";

/**
 * Recipe + production-batch server actions.
 *
 * Versioning: recipes are immutable once created. An edit NEVER updates a
 * live recipe row — createRecipeVersion retires the current version and
 * inserts a NEW row with the same code and version + 1. Batches record
 * recipe_id + recipe_version_used at draft time, so old batches keep the
 * version they actually ran even after a newer version is approved.
 *
 * Batch flow: createBatchDraft -> postBatch -> reverseBatch(reason).
 * Posting (exactly once, status guard + clientToken):
 *   1. Stock-guards every actual input in its godown (party-scoped when
 *      the material is customer-owned — service work on customer-owned
 *      material must NOT deduct company-owned stock).
 *   2. Deducts actual inputs (batch_consume ledger rows).
 *   3. Adds finished output + by-product stock (batch_produce rows).
 *      Waste is recorded on the header but never added to stock.
 *      A by-product is stocked ONLY if the caller supplies a
 *      byproductProductId — whether a by-product is saleable stock is a
 *      configured decision, not an assumption (client spec §6.4).
 *   4. Consumes packaging per recipe/batch (packaging_types.current_stock
 *      decremented, guarded; a packing_records row is written AND a
 *      bardana_ledger consumption row, so the ledger agrees with the
 *      stock card; reversal writes the restoration row).
 *   5. Computes yield % (usable output / total actual input) and per-input
 *      variance vs plan, stored on the batch (variances column) and
 *      returned, so variances survive posting instead of being dropped.
 *   Mass balance (output + by-product + waste <= input, no negatives,
 *   no output from zero input) is enforced here on the server, at
 *   draft creation AND at posting — the UI check is not trusted.
 *   Stock guards aggregate duplicate lines per (product, party)
 *   before comparing with the balance (inward B7 class of bug).
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
function revalidateProduction(): void {
  revalidatePath("/production");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

async function requireWrite(
  db: Db,
): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireRole(db, PRODUCTION_WRITE);
  if (!gate.ok) return { error: gate.error };
  return { actor: gate.actor };
}

/**
 * Variance tolerance from the settings team's `variance_tolerance_pct`
 * app_settings key. Absent / unparseable = null = gate disabled (never
 * a hard-coded %). The settings team owns the setting itself; this
 * only reads it.
 */
async function getVarianceTolerancePct(supabase: Db): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "variance_tolerance_pct")
      .maybeSingle();
    if (error || !data) return null;
    return parseVarianceTolerance((data as { value?: unknown }).value);
  } catch {
    return null;
  }
}

// Processing-type dropdowns: the machinery + packing pages import
// listProcessingTypes from app/actions/processing-types.ts (settings
// team, import only). An empty/failed result there means the forms
// fall back to free-text input — see that action's contract comment.

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
    { onConflict: "client_token,scope" },
  );
}

/** Bardana ledger row, mirroring the finance bardanaEntry helper
 * (finance.ts): quantities are BAG counts, running balance is the
 * previous row for this packaging type plus in minus out. */
async function bardanaEntry(
  supabase: Db,
  input: {
    date: string;
    voucherType: string;
    voucherId: string;
    voucherNo: string;
    packagingTypeId: string;
    godownId?: string | null;
    inQty: number;
    outQty: number;
    notes?: string;
    userId?: string | null;
    lineNo?: number;
  },
): Promise<void> {
  const { data: prev } = await supabase
    .from("bardana_ledger")
    .select("running_balance")
    .eq("packaging_type_id", input.packagingTypeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const running = (prev ? Number(prev.running_balance) || 0 : 0) + input.inQty - input.outQty;
  const { error } = await supabase.from("bardana_ledger").insert({
    date: input.date,
    packaging_type_id: input.packagingTypeId,
    godown_id: input.godownId ?? null,
    voucher_type: input.voucherType,
    voucher_id: input.voucherId,
    voucher_no: input.voucherNo,
    in_qty: input.inQty,
    out_qty: input.outQty,
    running_balance: running,
    notes: input.notes ?? null,
    created_by: input.userId ?? null,
    line_no: input.lineNo ?? 0,
  });
  if (error && isUniqueViolation(error)) return;
  if (error) throw new Error(`bardana_ledger insert failed: ${error.message}`);
}

async function stockBalance(supabase: Db, godownId: string, productId: string, partyId: string | null): Promise<number> {
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
  // A unique-violation here means this exact line is already written
  // (concurrent post, or a retry after a crash): skip it so the post
  // converges instead of failing on its own rows.
  if (error && isUniqueViolation(error)) return;
  if (error) throw new Error(error.message);
}

// ---------------- Recipes ----------------
export async function listRecipes(includeRetired = false): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    let query = supabase
      .from("recipes")
      .select("*, recipe_items(*)")
      .order("code")
      .order("version", { ascending: false });
    if (!includeRetired) query = query.eq("status", "active");
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function getRecipe(id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase
      .from("recipes")
      .select("*, recipe_items(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

function validateRecipeItems(items: { productId: string; ratioPct: number }[]): string | null {
  if (!items?.length) return "A recipe needs at least one component item";
  for (const item of items) {
    if (!item.productId) return "Every recipe item needs a productId";
    if (!Number.isFinite(item.ratioPct) || item.ratioPct <= 0 || item.ratioPct > 100) {
      return "Every recipe ratio must be between 0 and 100";
    }
  }
  const sum = items.reduce((s, i) => s + i.ratioPct, 0);
  if (Math.abs(sum - 100) > 0.01) {
    return `Recipe component ratios must sum to 100 (got ${sum})`;
  }
  return null;
}

export async function createRecipe(input: {
  code: string;
  name: string;
  outputProductId: string;
  expectedYieldPct?: number;
  packagingTypeId?: string;
  notes?: string;
  /** Nullable effective-from date (YYYY-MM-DD). No approval workflow:
   *  status stays active/retired as today. */
  effectiveFrom?: string | null;
  items: { productId: string; ratioPct: number; unit?: string }[];
}): Promise<ActionResult> {
  try {
    if (!input?.code?.trim() || !input?.name?.trim() || !input?.outputProductId) {
      return fail("Recipe code, name and outputProductId are required");
    }
    const itemError = validateRecipeItems(input.items);
    if (itemError) return fail(itemError);
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    // Server-side is_active check (UI filtering is never trusted).
    const activeError = await checkProductsActive(supabase, [
      input.outputProductId,
      ...input.items.map((i) => i.productId),
    ]);
    if (activeError) return fail(activeError);
    // Single-active-version guard (server side; the partial unique
    // index in migration-production-fixes.sql is the backstop).
    const { data: existingActive } = await supabase
      .from("recipes")
      .select("id")
      .eq("code", input.code.trim())
      .eq("status", "active")
      .limit(1);
    if (existingActive?.length) {
      return fail(
        `Recipe ${input.code.trim()} already has an active version — save a new version instead of creating a second active recipe.`,
      );
    }
    const { data: recipe, error } = await supabase
      .from("recipes")
      .insert({
        code: input.code.trim(),
        name: input.name.trim(),
        version: 1,
        output_product_id: input.outputProductId,
        expected_yield_pct: input.expectedYieldPct ?? null,
        packaging_type_id: input.packagingTypeId ?? null,
        effective_from: input.effectiveFrom ?? null,
        status: "active",
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) {
      // Unique-violation path (concurrent create racing this one):
      // surface it plainly, never as a silent second active version.
      if ((error as { code?: string }).code === "23505") {
        return fail(
          `Recipe ${input.code.trim()} already has an active version — save a new version instead of creating a second active recipe.`,
        );
      }
      return fail(error.message);
    }
    const { error: iError } = await supabase.from("recipe_items").insert(
      input.items.map((item) => ({
        recipe_id: recipe.id,
        product_id: item.productId,
        required_ratio_pct: item.ratioPct,
        unit: item.unit ?? "kg",
      })),
    );
    if (iError) {
      await supabase.from("recipes").delete().eq("id", recipe.id);
      return fail(iError.message);
    }
    revalidateProduction();
    return ok({ ...recipe, items: input.items });
  } catch (e) {
    return fail(errMessage(e));
  }
}

/**
 * Edit a recipe by versioning: retires the current active version of
 * `code` and creates a new active version (version + 1). Existing batches
 * keep pointing at their original recipe row/version.
 */
export async function createRecipeVersion(input: {
  code: string;
  name?: string;
  outputProductId: string;
  expectedYieldPct?: number;
  packagingTypeId?: string;
  notes?: string;
  effectiveFrom?: string | null;
  items: { productId: string; ratioPct: number; unit?: string }[];
}): Promise<ActionResult> {
  try {
    if (!input?.code?.trim() || !input?.outputProductId) {
      return fail("Recipe code and outputProductId are required");
    }
    const itemError = validateRecipeItems(input.items);
    if (itemError) return fail(itemError);
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const activeError = await checkProductsActive(supabase, [
      input.outputProductId,
      ...input.items.map((i) => i.productId),
    ]);
    if (activeError) return fail(activeError);
    const { data: current, error: cError } = await supabase
      .from("recipes")
      .select("*")
      .eq("code", input.code.trim())
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(1)
      .single();
    if (cError) return fail(`No active recipe found for code ${input.code.trim()}: ${cError.message}`);
    // Retire FIRST, then insert: with the single-active partial unique
    // index, inserting the new active version before retiring the old
    // one would violate the index. The retire is error-checked and
    // guarded on still-active, so a concurrent edit that retired this
    // version first fails here plainly instead of colliding silently.
    const { data: retired, error: rError } = await supabase
      .from("recipes")
      .update({ status: "retired" })
      .eq("id", current.id)
      .eq("status", "active")
      .select("id");
    if (rError) return fail(`Could not retire the current version of ${input.code.trim()}: ${rError.message}`);
    if (!retired?.length) {
      return fail(
        `Recipe ${input.code.trim()} was changed by someone else just now — reload the recipe list and try again.`,
      );
    }
    const { data: recipe, error } = await supabase
      .from("recipes")
      .insert({
        code: input.code.trim(),
        name: (input.name ?? current.name).trim(),
        version: Number(current.version) + 1,
        output_product_id: input.outputProductId,
        expected_yield_pct: input.expectedYieldPct ?? current.expected_yield_pct ?? null,
        packaging_type_id: input.packagingTypeId ?? current.packaging_type_id ?? null,
        effective_from: input.effectiveFrom ?? current.effective_from ?? null,
        status: "active",
        notes: input.notes ?? current.notes ?? null,
      })
      .select()
      .single();
    if (error) {
      // Best-effort restore: the old version was retired but its
      // replacement failed, so put the old version back to active
      // rather than leaving the code with no active version.
      await supabase.from("recipes").update({ status: "active" }).eq("id", current.id);
      if ((error as { code?: string }).code === "23505") {
        return fail(
          `Another active version of ${input.code.trim()} was created concurrently — reload the recipe list and try again.`,
        );
      }
      return fail(error.message);
    }
    const { error: iError } = await supabase.from("recipe_items").insert(
      input.items.map((item) => ({
        recipe_id: recipe.id,
        product_id: item.productId,
        required_ratio_pct: item.ratioPct,
        unit: item.unit ?? "kg",
      })),
    );
    if (iError) {
      await supabase.from("recipes").delete().eq("id", recipe.id);
      await supabase.from("recipes").update({ status: "active" }).eq("id", current.id);
      return fail(iError.message);
    }
    revalidateProduction();
    return ok({ ...recipe, items: input.items, previous_version_id: current.id });
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Batches ----------------
export async function listBatches(filters?: {
  status?: string;
  godownId?: string;
  recipeId?: string;
  from?: string;
  to?: string;
}): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    let query = supabase
      .from("production_batches")
      .select("*, production_batch_inputs(*), production_batch_outputs(*)")
      .order("date", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
    if (filters?.recipeId) query = query.eq("recipe_id", filters.recipeId);
    if (filters?.from) query = query.gte("date", filters.from);
    if (filters?.to) query = query.lte("date", filters.to);
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function getBatch(id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase
      .from("production_batches")
      .select("*, production_batch_inputs(*), production_batch_outputs(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function createBatchDraft(input: {
  recipeId?: string;
  machineId: string;
  godownId: string;
  plannedSizeKg: number;
  date?: string;
  notes?: string;
  isCustomerOwned?: boolean;
  ownerPartyId?: string;
  /** Customer the batch is run for (shown on the batch sheet). */
  customerId?: string | null;
  /** Customer order reference (shown on the batch sheet). */
  orderRef?: string | null;
  /** Operator who ran the batch (shown on the batch sheet). */
  operatorName?: string | null;
  /** Variance reason, recorded now when known; posting also accepts
   *  one via postBatch, so a draft is never stuck without a reason. */
  varianceReason?: string | null;
  inputs: { productId: string; actualQtyKg: number; plannedQtyKg?: number; partyId?: string }[];
  outputProductId: string;
  actualOutputKg: number;
  byproductProductId?: string;
  byproductKg?: number;
  wasteKg?: number;
  packagingTypeId?: string;
  bagsConsumed?: number;
  packingRatePerBag?: number;
  damagedBags?: number;
}): Promise<ActionResult> {
  try {
    if (!input?.machineId || !input?.godownId || !input?.outputProductId) {
      return fail("machineId, godownId and outputProductId are required");
    }
    if (!input.inputs?.length) return fail("A batch needs at least one actual input");
    if (input.plannedSizeKg <= 0) return fail("plannedSizeKg must be > 0");
    if (input.actualOutputKg < 0) return fail("actualOutputKg must be >= 0");
    for (const item of input.inputs) {
      if (!item.productId || item.actualQtyKg < 0) return fail("Every input needs a productId and actualQtyKg >= 0");
    }
    if ((input.bagsConsumed ?? 0) < 0 || (input.packingRatePerBag ?? 0) < 0 || (input.damagedBags ?? 0) < 0) {
      return fail("Bags consumed, packing rate and damaged bags cannot be negative");
    }
    // Server-side mass balance (trust boundary — never UI-only).
    const draftBalance = validateMassBalance({
      inputKg: input.inputs.reduce((s, i) => s + i.actualQtyKg, 0),
      outputKg: input.actualOutputKg,
      byproductKg: input.byproductKg ?? 0,
      wasteKg: input.wasteKg ?? 0,
    });
    if (draftBalance) return fail(draftBalance);
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    // Server-side is_active check on every selected product.
    const activeError = await checkProductsActive(supabase, [
      input.outputProductId,
      input.byproductProductId,
      ...input.inputs.map((i) => i.productId),
    ]);
    if (activeError) return fail(activeError);
    let recipeVersion: number | null = null;
    let recipeItems: { product_id: string; required_ratio_pct: number }[] = [];
    if (input.recipeId) {
      const { data: recipe, error } = await supabase
        .from("recipes")
        .select("*, recipe_items(*)")
        .eq("id", input.recipeId)
        .single();
      if (error) return fail(error.message);
      recipeVersion = Number(recipe.version);
      recipeItems = (recipe.recipe_items ?? []) as { product_id: string; required_ratio_pct: number }[];
    }
    const totalInput = roundWeight(input.inputs.reduce((s, i) => s + i.actualQtyKg, 0));
    const batchNo = await nextDocNumber(supabase, "batch", "BAT");
    const { data: batch, error } = await supabase
      .from("production_batches")
      .insert({
        batch_no: batchNo,
        date: input.date ?? new Date().toISOString(),
        recipe_id: input.recipeId ?? null,
        recipe_version_used: recipeVersion,
        machine_id: input.machineId,
        godown_id: input.godownId,
        planned_size_kg: roundWeight(input.plannedSizeKg),
        actual_input_kg: totalInput,
        actual_output_kg: roundWeight(input.actualOutputKg),
        output_product_id: input.outputProductId,
        byproduct_product_id: input.byproductProductId ?? null,
        byproduct_kg: roundWeight(input.byproductKg ?? 0),
        waste_kg: roundWeight(input.wasteKg ?? 0),
        yield_pct: yieldPct(input.actualOutputKg, totalInput),
        packaging_type_id: input.packagingTypeId ?? null,
        bags_consumed: input.bagsConsumed ?? 0,
        packing_rate_per_bag: input.packingRatePerBag ?? 0,
        damaged_bags: input.damagedBags ?? 0,
        is_customer_owned: input.isCustomerOwned ?? false,
        owner_party_id: input.ownerPartyId ?? null,
        customer_id: input.customerId ?? null,
        order_ref: input.orderRef?.trim() || null,
        operator_name: input.operatorName?.trim() || null,
        variance_reason: input.varianceReason?.trim() || null,
        status: "draft",
        notes: input.notes ?? null,
        created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (error) return fail(error.message);
    const inputRows = input.inputs.map((item) => {
      // Planned qty: caller-supplied, else recipe ratio x planned batch size,
      // else 0 (no recipe / no ratio for this component).
      let planned = item.plannedQtyKg ?? 0;
      if (item.plannedQtyKg === undefined || item.plannedQtyKg === null) {
        const ratio = recipeItems.find((r) => r.product_id === item.productId)?.required_ratio_pct;
        planned = ratio !== undefined ? plannedComponentQty(input.plannedSizeKg, ratio) : 0;
      }
      return {
        batch_id: batch.id,
        product_id: item.productId,
        planned_qty_kg: roundWeight(planned),
        actual_qty_kg: roundWeight(item.actualQtyKg),
        party_id: item.partyId ?? (input.isCustomerOwned ? input.ownerPartyId ?? null : null),
      };
    });
    const { error: iError } = await supabase.from("production_batch_inputs").insert(inputRows);
    if (iError) {
      await supabase.from("production_batches").delete().eq("id", batch.id);
      return fail(iError.message);
    }
    const outputRows = [
      { batch_id: batch.id, product_id: input.outputProductId, output_type: "finished", qty_kg: roundWeight(input.actualOutputKg) },
    ];
    if (input.byproductProductId && (input.byproductKg ?? 0) > 0) {
      outputRows.push({
        batch_id: batch.id,
        product_id: input.byproductProductId,
        output_type: "byproduct",
        qty_kg: roundWeight(input.byproductKg ?? 0),
      });
    }
    const { error: oError } = await supabase.from("production_batch_outputs").insert(outputRows);
    if (oError) {
      await supabase.from("production_batches").delete().eq("id", batch.id);
      return fail(oError.message);
    }
    revalidateProduction();
    return ok({ ...batch, inputs: inputRows, outputs: outputRows });
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function postBatch(id: string, clientToken?: string, varianceReason?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "batch:post", clientToken);
    if (replay) return replay;
    const { data: batch, error } = await supabase
      .from("production_batches")
      .select("*, production_batch_inputs(*), production_batch_outputs(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    // Already posted is a successful replay, not a second posting.
    if (batch.status === "posted") return ok(batch);
    if (batch.status !== "draft") return fail(`Only a draft can be posted (status: ${batch.status})`);
    // Variance-tolerance gate, BEFORE any stock moves: when the
    // configured tolerance exists and an input variance exceeds it,
    // a variance reason must be on the batch (stored, or supplied
    // with this post call) before posting. Null tolerance = disabled.
    const gateInputs = (batch.production_batch_inputs ?? []) as {
      planned_qty_kg: number;
      actual_qty_kg: number;
    }[];
    const gateVariances = gateInputs.map((item) => ({
      ...variance(item.actual_qty_kg, item.planned_qty_kg),
    }));
    const tolerance = await getVarianceTolerancePct(supabase);
    if (varianceExceedsTolerance(gateVariances, tolerance)) {
      const supplied = varianceReason?.trim() || "";
      if (!supplied && !(batch.variance_reason ?? "").trim()) {
        return fail(
          `Batch ${batch.batch_no} cannot be posted: an input variance exceeds the configured tolerance of ${tolerance}% — record a variance reason for this batch and post again.`,
        );
      }
      if (supplied) {
        await supabase
          .from("production_batches")
          .update({ variance_reason: supplied })
          .eq("id", id)
          .eq("status", "draft");
        batch.variance_reason = supplied;
      }
    }
    const inputs = (batch.production_batch_inputs ?? []) as {
      product_id: string;
      planned_qty_kg: number;
      actual_qty_kg: number;
      party_id: string | null;
    }[];
    const outputs = (batch.production_batch_outputs ?? []) as {
      product_id: string;
      output_type: string;
      qty_kg: number;
    }[];
    if (!inputs.length) return fail("Cannot post a batch with no inputs");
    // Server-side mass balance re-check on the STORED values: a draft
    // created before this validation (or by any other caller) must
    // not post an impossible batch.
    const finishedForBalance = outputs.find((o) => o.output_type === "finished");
    const byproductForBalance = outputs.find((o) => o.output_type === "byproduct");
    const postBalance = validateMassBalance({
      inputKg: inputs.reduce((s, i) => s + i.actual_qty_kg, 0),
      outputKg: finishedForBalance?.qty_kg ?? batch.actual_output_kg,
      byproductKg: byproductForBalance?.qty_kg ?? batch.byproduct_kg ?? 0,
      wasteKg: batch.waste_kg ?? 0,
    });
    if (postBalance) return fail(`Cannot post batch ${batch.batch_no}: ${postBalance}`);
    // Stock guard, aggregated per (product, party): duplicate lines
    // must not each pass against the same pre-post balance (B7 class).
    for (const item of aggregateQuantities(
      inputs.map((i) => ({ productId: i.product_id, partyId: i.party_id ?? null, qtyKg: i.actual_qty_kg })),
    )) {
      const available = await stockBalance(supabase, batch.godown_id, item.productId, item.partyId);
      if (available < roundWeight(item.qtyKg)) {
        return fail(
          `Insufficient stock for batch ${batch.batch_no}: product ${item.productId} has ${available} kg available, batch needs ${item.qtyKg} kg`,
        );
      }
    }
    // Packaging guard: packed + damaged bags both leave stock.
    let packaging: { id: string; capacity_kg: number; current_stock: number } | null = null;
    const bags = Number(batch.bags_consumed ?? 0);
    const damagedForGuard = Number(batch.damaged_bags ?? 0);
    if (batch.packaging_type_id && bags > 0) {
      const { data: pkg, error: pError } = await supabase
        .from("packaging_types")
        .select("id, capacity_kg, current_stock")
        .eq("id", batch.packaging_type_id)
        .single();
      if (pError) return fail(pError.message);
      packaging = pkg;
      if (Number(pkg.current_stock) < bags + damagedForGuard) {
        return fail(
          `Insufficient packaging stock for batch ${batch.batch_no}: ${pkg.current_stock} bags available, batch needs ${bags + damagedForGuard} (${bags} packed + ${damagedForGuard} damaged)`,
        );
      }
    }
    const by = gate.actor.userId;
    const ownerParty: string | null = batch.is_customer_owned ? batch.owner_party_id ?? null : null;
    // Batch posting stays loop-based, NOT on atomic_stock_transition:
    // the flip also writes computed fields (yield, variances) and the
    // packaging stock / bardana / packing-record legs sit outside any
    // stock-only function. Exact-once for the LEDGER legs comes from
    // the (voucher_type, voucher_id, entry_kind, line_no) identity
    // plus skip-on-duplicate above, and from the flip replay below —
    // so a retry after a crash converges instead of duplicating.
    // Residual risk (packaging legs) is stated in the Phase D report.
    for (let i = 0; i < inputs.length; i++) {
      const item = inputs[i];
      await appendLedger(
        supabase,
        {
          voucher_type: "batch_consume",
          voucher_id: batch.id,
          voucher_no: batch.batch_no,
          godown_id: batch.godown_id,
          product_id: item.product_id,
          party_id: item.party_id ?? null,
          inward_qty: 0,
          outward_qty: roundWeight(item.actual_qty_kg),
          entryKind: "post",
          lineNo: i,
        },
        by,
      );
    }
    for (let i = 0; i < outputs.length; i++) {
      const out = outputs[i];
      await appendLedger(
        supabase,
        {
          voucher_type: "batch_produce",
          voucher_id: batch.id,
          voucher_no: batch.batch_no,
          godown_id: batch.godown_id,
          product_id: out.product_id,
          // Outputs of a customer-owned job belong to the owner, not the company.
          party_id: ownerParty,
          inward_qty: roundWeight(out.qty_kg),
          outward_qty: 0,
          entryKind: "post",
          lineNo: i,
        },
        by,
      );
    }
    const damaged = Number(batch.damaged_bags ?? 0);
    if (packaging && bags > 0) {
      const { error: pkgError } = await supabase
        .from("packaging_types")
        .update({ current_stock: Number(packaging.current_stock) - (bags + damaged) })
        .eq("id", packaging.id);
      if (pkgError) return fail(pkgError.message);
      // Bardana ledger consumption (bags packed + bags damaged both
      // leave bardana stock), so the ledger agrees with the stock card.
      await bardanaEntry(supabase, {
        date: batch.date,
        voucherType: "batch_packing",
        voucherId: batch.id,
        voucherNo: batch.batch_no,
        packagingTypeId: packaging.id,
        godownId: batch.godown_id,
        inQty: 0,
        outQty: bags + damaged,
        notes: `Batch packing ${batch.batch_no}: ${bags} packed + ${damaged} damaged`,
        userId: by,
      });
      const { data: packRecord, error: recError } = await supabase.from("packing_records").insert({
        packing_no: batch.batch_no,
        date: batch.date,
        job_or_batch_id: batch.id,
        output_product_id: batch.output_product_id ?? null,
        packaging_type_id: packaging.id,
        bags_count: bags,
        capacity_kg: packaging.capacity_kg,
        // Real packed weight: the batch's actual output, never
        // bags x current capacity.
        total_packed_kg: roundWeight(batch.actual_output_kg),
        packing_rate: batch.packing_rate_per_bag ?? 0,
        packing_charge: packingCharge(bags, batch.packing_rate_per_bag ?? 0),
        damaged_bags: damaged,
        status: "posted",
        created_by: by,
      })
        .select()
        .single();
      if (recError) return fail(recError.message);
      // Batch packing writes exactly ONE packing line (compatibility:
      // the standalone form may write many). Best-effort so a live
      // database that has not applied the lines migration yet does
      // not fail a batch post — the header row above is the record.
      try {
        if (packRecord?.id) {
          await supabase.from("packing_lines").insert({
            packing_record_id: packRecord.id,
            line_no: 0,
            packaging_type_id: packaging.id,
            bags,
            packed_kg: roundWeight(batch.actual_output_kg),
            charge: packingCharge(bags, batch.packing_rate_per_bag ?? 0),
          });
        }
      } catch (lineErr) {
        console.error("[packing] batch packing_lines insert failed:", lineErr);
      }
    }
    const totalInput = roundWeight(inputs.reduce((s, i) => s + i.actual_qty_kg, 0));
    // Yield = SUM of ALL finished outputs / total input (by-product
    // never counts). Taking only the first finished row understated
    // multi-output batches. A batch with no finished rows at all
    // (legacy data) still falls back to its header output weight.
    const finishedKg = outputs.some((o) => o.output_type === "finished")
      ? sumFinishedOutputs(outputs)
      : Number(batch.actual_output_kg ?? 0);
    const computedYield = yieldPct(finishedKg, totalInput);
    const variances = inputs.map((item) => ({
      product_id: item.product_id,
      planned_qty_kg: roundWeight(item.planned_qty_kg),
      actual_qty_kg: roundWeight(item.actual_qty_kg),
      ...variance(item.actual_qty_kg, item.planned_qty_kg),
    }));
    const { data: posted, error: uError } = await supabase
      .from("production_batches")
      .update({
        status: "posted",
        posted_at: new Date().toISOString(),
        updated_by: by,
        actual_input_kg: totalInput,
        yield_pct: computedYield,
        // Stored, not dropped: batch detail and the batch sheet
        // read these back instead of recomputing from live data.
        variances,
      })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError) {
      // A concurrent post may have flipped this batch after our
      // ledger rows landed: the union of both writers' rows is the
      // complete set (identity index), so a posted batch is a
      // successful replay, not a failure.
      const { data: now } = await supabase
        .from("production_batches")
        .select("*")
        .eq("id", id)
        .single();
      if (now?.status === "posted") return ok({ ...now, inputs, outputs });
      return fail(uError.message);
    }
    const result = { ...posted, inputs, outputs, variances, yield_pct: computedYield };
    await storeIdempotency(supabase, "batch:post", clientToken, "batch", id, batch.batch_no, result);
    // Cost-ledger (wave 2, gated, best-effort): when cost_ledger_enabled
    // is off this writes nothing; a ledger failure is logged, never a
    // reason to fail a batch that already posted.
    try {
      const dbForCosts = supabase as unknown as Parameters<
        typeof writeCostLedgerRows
      >[0];
      const method = await getValuationMethod(dbForCosts);
      const methodSet =
        method === "last_purchase_cost" || method === "average_cost";
      const basis = methodSet ? method : "unconfirmed-method";
      const unitCosts = await ingredientUnitCosts(
        dbForCosts,
        inputs.map((i) => i.product_id),
        method,
      );
      const costEntries: CostLedgerEntry[] = [];
      if (bags > 0) {
        costEntries.push({
          batchId: id,
          costType: "packaging",
          amount: packingCharge(bags, batch.packing_rate_per_bag ?? 0),
          qtyKg: roundWeight(batch.actual_output_kg),
          basis: "bags×rate",
        });
      }
      for (const item of inputs) {
        const unit = unitCosts.get(item.product_id) ?? null;
        costEntries.push({
          batchId: id,
          costType: "input",
          qtyKg: roundWeight(item.actual_qty_kg),
          amount:
            unit !== null
              ? roundMoney(roundWeight(item.actual_qty_kg) * unit)
              : null,
          basis,
        });
      }
      for (const out of outputs) {
        costEntries.push({
          batchId: id,
          costType: "output",
          qtyKg: roundWeight(out.qty_kg),
          amount: null,
          basis,
        });
      }
      const costRes = await writeCostLedgerRows(dbForCosts, costEntries);
      if (costRes.error) {
        console.error("[cost-ledger] batch cost write failed:", costRes.error);
      }
    } catch (costErr) {
      console.error("[cost-ledger] batch cost write failed:", costErr);
    }
    await logAudit(supabase, {
      action: "post",
      entityType: "production_batch",
      entityId: id,
      voucherNo: batch.batch_no,
      before: { status: "draft" },
      after: { status: "posted", yield_pct: computedYield, actual_input_kg: totalInput },
      userId: by,
      userEmail: gate.actor.email,
    });
    revalidateProduction();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

/** Record (or replace) a variance reason on a DRAFT batch, so a batch
 *  blocked by the tolerance gate can be posted without recreating it. */
export async function setBatchVarianceReason(id: string, reason: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A variance reason is required");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const { data, error } = await supabase
      .from("production_batches")
      .update({ variance_reason: reason.trim() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (error || !data) return fail("Only a draft batch can take a variance reason");
    revalidateProduction();
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function reverseBatch(id: string, reason: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A reversal reason is mandatory");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "batch:reverse", clientToken);
    if (replay) return replay;
    const { data: batch, error } = await supabase
      .from("production_batches")
      .select("*, production_batch_inputs(*), production_batch_outputs(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    // Already reversed is a successful replay, not a second reversal.
    if (batch.status === "reversed") return ok(batch);
    if (batch.status !== "posted") {
      return fail(`Only a posted batch can be reversed (status: ${batch.status})`);
    }
    const inputs = (batch.production_batch_inputs ?? []) as {
      product_id: string;
      actual_qty_kg: number;
      party_id: string | null;
    }[];
    const outputs = (batch.production_batch_outputs ?? []) as {
      product_id: string;
      qty_kg: number;
    }[];
    const ownerParty: string | null = batch.is_customer_owned ? batch.owner_party_id ?? null : null;
    // Reversal guard, aggregated per (product, owner pool): duplicate
    // output lines must not each pass against the same balance.
    for (const out of aggregateQuantities(
      outputs.map((o) => ({ productId: o.product_id, partyId: ownerParty, qtyKg: o.qty_kg })),
    )) {
      const available = await stockBalance(supabase, batch.godown_id, out.productId, out.partyId);
      if (available < roundWeight(out.qtyKg)) {
        return fail(
          `Cannot reverse batch ${batch.batch_no}: output product ${out.productId} has only ${available} kg on hand, reversal needs ${out.qtyKg} kg`,
        );
      }
    }
    const by = gate.actor.userId;
    for (let i = 0; i < outputs.length; i++) {
      const out = outputs[i];
      await appendLedger(
        supabase,
        {
          voucher_type: "batch_produce",
          voucher_id: batch.id,
          voucher_no: batch.batch_no,
          godown_id: batch.godown_id,
          product_id: out.product_id,
          party_id: ownerParty,
          inward_qty: 0,
          outward_qty: roundWeight(out.qty_kg),
          notes: `Reversal of ${batch.batch_no}: ${reason.trim()}`,
          entryKind: "reversal",
          lineNo: i,
        },
        by,
      );
    }
    for (let i = 0; i < inputs.length; i++) {
      const item = inputs[i];
      await appendLedger(
        supabase,
        {
          voucher_type: "batch_consume",
          voucher_id: batch.id,
          voucher_no: batch.batch_no,
          godown_id: batch.godown_id,
          product_id: item.product_id,
          party_id: item.party_id ?? null,
          inward_qty: roundWeight(item.actual_qty_kg),
          outward_qty: 0,
          notes: `Reversal of ${batch.batch_no}: ${reason.trim()}`,
          entryKind: "reversal",
          lineNo: i,
        },
        by,
      );
    }
    const bags = Number(batch.bags_consumed ?? 0);
    const damaged = Number(batch.damaged_bags ?? 0);
    if (batch.packaging_type_id && bags > 0) {
      const { data: pkg } = await supabase
        .from("packaging_types")
        .select("current_stock")
        .eq("id", batch.packaging_type_id)
        .single();
      if (pkg) {
        const { error: pkgError } = await supabase
          .from("packaging_types")
          .update({ current_stock: Number(pkg.current_stock) + bags + damaged })
          .eq("id", batch.packaging_type_id);
        if (pkgError) return fail(pkgError.message);
      }
      // Bardana ledger restoration, mirroring the post consumption.
      await bardanaEntry(supabase, {
        date: new Date().toISOString(),
        voucherType: "batch_packing_reversal",
        voucherId: batch.id,
        voucherNo: `${batch.batch_no}-R`,
        packagingTypeId: batch.packaging_type_id,
        godownId: batch.godown_id,
        inQty: bags + damaged,
        outQty: 0,
        notes: `Reversal of ${batch.batch_no}: ${reason.trim()}`,
        userId: by,
      });
      const { error: recError } = await supabase
        .from("packing_records")
        .update({ status: "reversed" })
        .eq("job_or_batch_id", batch.id);
      if (recError) return fail(recError.message);
    }
    const { data: reversed, error: uError } = await supabase
      .from("production_batches")
      .update({ status: "reversed", reversal_reason: reason.trim(), reversed_at: new Date().toISOString(), updated_by: gate.actor.userId })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError) {
      const { data: now } = await supabase
        .from("production_batches")
        .select("*")
        .eq("id", id)
        .single();
      if (now?.status === "reversed") return ok({ ...now, inputs, outputs });
      return fail(uError.message);
    }
    const result = { ...reversed, inputs, outputs };
    await storeIdempotency(supabase, "batch:reverse", clientToken, "batch", id, batch.batch_no, result);
    await logAudit(supabase, {
      action: "reverse",
      entityType: "production_batch",
      entityId: id,
      voucherNo: batch.batch_no,
      before: { status: "posted" },
      after: { status: "reversed" },
      reason: reason.trim(),
      userId: by,
      userEmail: gate.actor.email,
    });
    revalidateProduction();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Draft delete (orphan drafts) ----------------
/** Delete a batch that never posted (e.g. its post failed). Posted and
 * reversed batches are never deleted — they reverse, with a reason. */
export async function deleteBatchDraft(id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const { data, error } = await supabase
      .from("production_batches")
      .delete()
      .eq("id", id)
      .eq("status", "draft")
      .select("id")
      .single();
    if (error || !data) return fail("Only a draft batch can be deleted");
    revalidateProduction();
    return ok({ id });
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Packing records (history truth) ----------------
/**
 * Packing history built from the packing_records table itself — real
 * stored values (packed kg, charge, damaged count, status), never
 * bags x current capacity and never a hardcoded status. Batch-linked
 * rows resolve their product/batch through the batch row; standalone
 * rows carry their own output_product_id.
 */
export async function listPackingRecords(): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const { data: records, error } = await supabase
      .from("packing_records")
      .select("*")
      .order("date", { ascending: false });
    if (error) return fail(error.message);
    const rows = (records ?? []) as Record<string, unknown>[];
    const batchIds = [...new Set(rows.map((r) => r.job_or_batch_id).filter(Boolean))] as string[];
    const productIds = [...new Set(rows.map((r) => r.output_product_id).filter(Boolean))] as string[];
    const packagingIds = [...new Set(rows.map((r) => r.packaging_type_id).filter(Boolean))] as string[];
    const [batches, products, packaging] = await Promise.all([
      batchIds.length
        ? supabase.from("production_batches").select("id, batch_no, output_product_id").in("id", batchIds)
        : Promise.resolve({ data: [] as unknown[] }),
      productIds.length
        ? supabase.from("products").select("id, name").in("id", productIds)
        : Promise.resolve({ data: [] as unknown[] }),
      packagingIds.length
        ? supabase.from("packaging_types").select("id, name, capacity_kg").in("id", packagingIds)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);
    const batchById = new Map(((batches.data ?? []) as Record<string, unknown>[]).map((b) => [b.id as string, b]));
    const productById = new Map(((products.data ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
    const packagingById = new Map(((packaging.data ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
    // Batch-linked rows without their own product resolve via the batch.
    const batchProductIds = [...new Set(
      rows
        .filter((r) => !r.output_product_id && r.job_or_batch_id)
        .map((r) => batchById.get(r.job_or_batch_id as string)?.output_product_id)
        .filter(Boolean),
    )] as string[];
    if (batchProductIds.length) {
      const { data: extra } = await supabase.from("products").select("id, name").in("id", batchProductIds);
      for (const p of (extra ?? []) as Record<string, unknown>[]) productById.set(p.id as string, p);
    }
    // Multi-line packing + treatment inputs, best-effort: a live
    // database that has not applied the lines migration yet still
    // lists its header rows.
    let linesByRecord = new Map<string, unknown[]>();
    let treatmentsByRecord = new Map<string, unknown[]>();
    try {
      const recordIds = rows.map((r) => r.id as string).filter(Boolean);
      if (recordIds.length) {
        const [lines, treatments] = await Promise.all([
          supabase.from("packing_lines").select("*").in("packing_record_id", recordIds).order("line_no"),
          supabase.from("packing_treatment_inputs").select("*").in("packing_record_id", recordIds),
        ]);
        for (const l of (lines.data ?? []) as Record<string, unknown>[]) {
          const key = l.packing_record_id as string;
          linesByRecord.set(key, [...(linesByRecord.get(key) ?? []), l]);
        }
        for (const t of (treatments.data ?? []) as Record<string, unknown>[]) {
          const key = t.packing_record_id as string;
          treatmentsByRecord.set(key, [...(treatmentsByRecord.get(key) ?? []), t]);
        }
      }
    } catch {
      // Header rows remain the truth; lines/treatments are enrichment.
    }
    const partyIds = [...new Set(rows.map((r) => r.party_id).filter(Boolean))] as string[];
    let partyById = new Map<string, unknown>();
    if (partyIds.length) {
      const { data: parties } = await supabase.from("parties").select("id, name").in("id", partyIds);
      partyById = new Map(((parties ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
    }
    const enriched = rows.map((r) => {
      const batch = batchById.get(r.job_or_batch_id as string);
      const productId = (r.output_product_id as string) ?? (batch?.output_product_id as string);
      const pkg = packagingById.get(r.packaging_type_id as string);
      return {
        ...r,
        packing_no: r.packing_no ?? batch?.batch_no ?? null,
        output_product_id: productId ?? null,
        output_product_name: productById.get(productId)?.name ?? productId ?? null,
        packaging_name: pkg?.name ?? r.packaging_type_id,
        batch_no: batch?.batch_no ?? null,
        party_name: r.party_id ? (partyById.get(r.party_id as string) as { name?: string } | undefined)?.name ?? r.party_id : null,
        packing_lines: linesByRecord.get(r.id as string) ?? [],
        treatment_inputs: treatmentsByRecord.get(r.id as string) ?? [],
      };
    });
    return ok(enriched);
  } catch (e) {
    return fail(errMessage(e));
  }
}

/**
 * Standalone packing write (the Packing page's "New Packing" path):
 * consumes bardana (packed + damaged bags leave stock, with a ledger
 * row) and writes a real packing_records row with the ENTERED packed
 * weight — never bags x capacity. Seed stock is untouched: this packs
 * output that is already in stock. Packing that moves seed stock is
 * recorded by posting a production batch with packaging fields.
 */
export async function createPackingRecord(input: {
  packagingTypeId: string;
  outputProductId?: string;
  bagsPacked: number;
  damagedBags?: number;
  packingRatePerBag?: number;
  packedKg: number;
  godownId?: string;
  date?: string;
  /** Multi-line packing: each line packs one bag type. When omitted,
   *  the legacy single line (packagingTypeId / bagsPacked / packedKg)
   *  is used, so old callers keep working exactly as before. */
  lines?: { packagingTypeId: string; bags: number; packedKg: number }[];
  /** Customer/owner party the packing was done for (NULL = company). */
  partyId?: string | null;
  processingType?: string | null;
  sourceProductId?: string | null;
  netWeightKg?: number | null;
  processingAmount?: number;
  /** Manual packing-fee override: when the operator enters one, the
   *  header charge equals it instead of computed bags x rate, and it
   *  is stored in manual_packing_fee so the override is visible. */
  manualPackingFee?: number | null;
  notes?: string | null;
  /** Treatment inputs: RECORD-ONLY. They are stored and never deduct
   *  stock — no ledger row, no stock write of any kind is made here. */
  treatmentInputs?: { materialName: string; qty: number; unit?: string; note?: string }[];
}): Promise<ActionResult> {
  try {
    if (!input?.packagingTypeId) return fail("packagingTypeId is required");
    if ((input.damagedBags ?? 0) < 0) return fail("Damaged bags cannot be negative");
    if ((input.packingRatePerBag ?? 0) < 0) return fail("Packing rate cannot be negative");
    if ((input.processingAmount ?? 0) < 0) return fail("Processing amount cannot be negative");
    if (input.manualPackingFee !== undefined && input.manualPackingFee !== null && input.manualPackingFee < 0) {
      return fail("Manual packing fee cannot be negative");
    }
    const lines = input.lines?.length
      ? input.lines
      : [{ packagingTypeId: input.packagingTypeId, bags: input.bagsPacked, packedKg: input.packedKg }];
    for (const line of lines) {
      if (!line.packagingTypeId) return fail("Every packing line needs a packaging type");
      if (!(line.bags >= 0)) return fail("Bags per packing line cannot be negative");
      if (!(line.packedKg >= 0)) return fail("Packed weight per packing line cannot be negative");
    }
    const totalLineBags = lines.reduce((s, l) => s + l.bags, 0);
    if (!(totalLineBags > 0)) return fail("Bags packed must be greater than zero");
    const totalPackedKg = roundWeight(lines.reduce((s, l) => s + l.packedKg, 0));
    if (!(totalPackedKg >= 0)) return fail("Packed weight cannot be negative");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const activeError = await checkProductsActive(supabase, [input.outputProductId, input.sourceProductId]);
    if (activeError) return fail(activeError);
    // Bardana guard, aggregated per packaging type: duplicate lines
    // for one bag type must not each pass against the same balance.
    // Damaged bags are of the header bag type (the legacy single type,
    // or the first line's type for multi-line runs).
    const damaged = input.damagedBags ?? 0;
    const damagedTypeId = input.packagingTypeId;
    const bagsByType = new Map<string, number>();
    for (const line of lines) {
      bagsByType.set(line.packagingTypeId, (bagsByType.get(line.packagingTypeId) ?? 0) + line.bags);
    }
    bagsByType.set(damagedTypeId, (bagsByType.get(damagedTypeId) ?? 0) + damaged);
    const pkgById = new Map<string, { id: string; capacity_kg: number; current_stock: number }>();
    for (const [typeId, needed] of bagsByType) {
      const { data: pkg, error: pError } = await supabase
        .from("packaging_types")
        .select("id, capacity_kg, current_stock")
        .eq("id", typeId)
        .single();
      if (pError) return fail(pError.message);
      pkgById.set(typeId, pkg);
      if (Number(pkg.current_stock) < needed) {
        return fail(
          `Insufficient packaging stock: ${pkg.current_stock} bags of this type available, ${needed} needed`,
        );
      }
    }
    const by = gate.actor.userId;
    const packingNo = await nextDocNumber(supabase, "packing", "PCK");
    const date = input.date ?? new Date().toISOString();
    const rate = input.packingRatePerBag ?? 0;
    const computedCharge = lines.reduce((s, l) => s + packingCharge(l.bags, rate), 0);
    const manualFee = input.manualPackingFee ?? null;
    const headerCharge = manualFee !== null ? manualFee : computedCharge;
    const headerPkg = pkgById.get(input.packagingTypeId);
    for (const [typeId, needed] of bagsByType) {
      const pkg = pkgById.get(typeId);
      if (!pkg) continue;
      const { error: pkgError } = await supabase
        .from("packaging_types")
        .update({ current_stock: Number(pkg.current_stock) - needed })
        .eq("id", typeId);
      if (pkgError) return fail(pkgError.message);
      await bardanaEntry(supabase, {
        date,
        voucherType: "packing",
        voucherId: packingNo,
        voucherNo: packingNo,
        packagingTypeId: typeId,
        godownId: input.godownId ?? null,
        inQty: 0,
        outQty: needed,
        notes: `Packing ${packingNo}: ${needed} bags`,
        userId: by,
      });
    }
    const { data: record, error } = await supabase
      .from("packing_records")
      .insert({
        packing_no: packingNo,
        date,
        job_or_batch_id: null,
        output_product_id: input.outputProductId ?? null,
        packaging_type_id: input.packagingTypeId,
        bags_count: totalLineBags,
        capacity_kg: headerPkg?.capacity_kg ?? 50,
        total_packed_kg: totalPackedKg,
        packing_rate: rate,
        packing_charge: headerCharge,
        damaged_bags: damaged,
        status: "posted",
        party_id: input.partyId ?? null,
        processing_type: input.processingType?.trim() || null,
        source_product_id: input.sourceProductId ?? input.outputProductId ?? null,
        net_weight_kg: input.netWeightKg ?? totalPackedKg,
        processing_amount: input.processingAmount ?? 0,
        notes: input.notes?.trim() || null,
        manual_packing_fee: manualFee,
        created_by: by,
      })
      .select()
      .single();
    if (error) return fail(error.message);
    // Packing lines (best-effort pre-migration: the header row above
    // is the record, lines are its breakdown).
    try {
      await supabase.from("packing_lines").insert(
        lines.map((line, i) => ({
          packing_record_id: record.id,
          line_no: i,
          packaging_type_id: line.packagingTypeId,
          bags: line.bags,
          packed_kg: roundWeight(line.packedKg),
          charge: packingCharge(line.bags, rate),
        })),
      );
    } catch (lineErr) {
      console.error("[packing] packing_lines insert failed:", lineErr);
    }
    // Treatment inputs: RECORD-ONLY. No stock deduction, no ledger
    // row — spec gates inventory impact on client confirmation.
    const treatments = (input.treatmentInputs ?? []).filter((t) => t.materialName?.trim());
    if (treatments.length) {
      try {
        await supabase.from("packing_treatment_inputs").insert(
          treatments.map((t) => ({
            packing_record_id: record.id,
            material_name: t.materialName.trim(),
            qty: t.qty,
            unit: t.unit?.trim() || "kg",
            note: t.note?.trim() || null,
          })),
        );
      } catch (treatErr) {
        console.error("[packing] treatment inputs insert failed:", treatErr);
      }
    }
    await logAudit(supabase, {
      action: "create",
      entityType: "packing_record",
      entityId: record.id,
      voucherNo: packingNo,
      after: { status: "posted", bags: totalLineBags, packed_kg: totalPackedKg, charge: headerCharge },
      userId: by,
      userEmail: gate.actor.email,
    });
    revalidateProduction();
    return ok(record);
  } catch (e) {
    return fail(errMessage(e));
  }
}
