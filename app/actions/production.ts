"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  roundWeight,
  ledgerRunningBalance,
  stockBalanceFromRows,
  yieldPct,
  variance,
  plannedComponentQty,
  packingCharge,
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
 *      decremented, guarded; a packing_records row is written).
 *   5. Computes yield % (usable output / total actual input) and per-input
 *      variance vs plan, stored/returned on the batch.
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

// ---------------- Recipes ----------------
export async function listRecipes(includeRetired = false): Promise<ActionResult> {
  try {
    const supabase = await createClient();
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
  items: { productId: string; ratioPct: number; unit?: string }[];
}): Promise<ActionResult> {
  try {
    if (!input?.code?.trim() || !input?.name?.trim() || !input?.outputProductId) {
      return fail("Recipe code, name and outputProductId are required");
    }
    const itemError = validateRecipeItems(input.items);
    if (itemError) return fail(itemError);
    const supabase = await createClient();
    const { data: recipe, error } = await supabase
      .from("recipes")
      .insert({
        code: input.code.trim(),
        name: input.name.trim(),
        version: 1,
        output_product_id: input.outputProductId,
        expected_yield_pct: input.expectedYieldPct ?? null,
        packaging_type_id: input.packagingTypeId ?? null,
        status: "active",
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) return fail(error.message);
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
  items: { productId: string; ratioPct: number; unit?: string }[];
}): Promise<ActionResult> {
  try {
    if (!input?.code?.trim() || !input?.outputProductId) {
      return fail("Recipe code and outputProductId are required");
    }
    const itemError = validateRecipeItems(input.items);
    if (itemError) return fail(itemError);
    const supabase = await createClient();
    const { data: current, error: cError } = await supabase
      .from("recipes")
      .select("*")
      .eq("code", input.code.trim())
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(1)
      .single();
    if (cError) return fail(`No active recipe found for code ${input.code.trim()}: ${cError.message}`);
    const { data: recipe, error } = await supabase
      .from("recipes")
      .insert({
        code: input.code.trim(),
        name: (input.name ?? current.name).trim(),
        version: Number(current.version) + 1,
        output_product_id: input.outputProductId,
        expected_yield_pct: input.expectedYieldPct ?? current.expected_yield_pct ?? null,
        packaging_type_id: input.packagingTypeId ?? current.packaging_type_id ?? null,
        status: "active",
        notes: input.notes ?? current.notes ?? null,
      })
      .select()
      .single();
    if (error) return fail(error.message);
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
    await supabase.from("recipes").update({ status: "retired" }).eq("id", current.id);
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
  inputs: { productId: string; actualQtyKg: number; plannedQtyKg?: number; partyId?: string }[];
  outputProductId: string;
  actualOutputKg: number;
  byproductProductId?: string;
  byproductKg?: number;
  wasteKg?: number;
  packagingTypeId?: string;
  bagsConsumed?: number;
  packingRatePerBag?: number;
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
    const supabase = await createClient();
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
        is_customer_owned: input.isCustomerOwned ?? false,
        owner_party_id: input.ownerPartyId ?? null,
        status: "draft",
        notes: input.notes ?? null,
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

export async function postBatch(id: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const replay = await checkIdempotency(supabase, "batch:post", clientToken);
    if (replay) return replay;
    const { data: batch, error } = await supabase
      .from("production_batches")
      .select("*, production_batch_inputs(*), production_batch_outputs(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    if (batch.status === "posted") return fail(`Batch ${batch.batch_no} is already posted`);
    if (batch.status !== "draft") return fail(`Only a draft can be posted (status: ${batch.status})`);
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
    // Stock guard on every component (party-scoped for customer-owned material).
    for (const item of inputs) {
      const available = await stockBalance(supabase, batch.godown_id, item.product_id, item.party_id ?? null);
      if (available < roundWeight(item.actual_qty_kg)) {
        return fail(
          `Insufficient stock for batch ${batch.batch_no}: product ${item.product_id} has ${available} kg available, batch needs ${item.actual_qty_kg} kg`,
        );
      }
    }
    // Packaging guard.
    let packaging: { id: string; capacity_kg: number; current_stock: number } | null = null;
    const bags = Number(batch.bags_consumed ?? 0);
    if (batch.packaging_type_id && bags > 0) {
      const { data: pkg, error: pError } = await supabase
        .from("packaging_types")
        .select("id, capacity_kg, current_stock")
        .eq("id", batch.packaging_type_id)
        .single();
      if (pError) return fail(pError.message);
      packaging = pkg;
      if (Number(pkg.current_stock) < bags) {
        return fail(
          `Insufficient packaging stock for batch ${batch.batch_no}: ${pkg.current_stock} bags available, batch needs ${bags}`,
        );
      }
    }
    const by = await createdBy(supabase);
    const ownerParty: string | null = batch.is_customer_owned ? batch.owner_party_id ?? null : null;
    for (const item of inputs) {
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
        },
        by,
      );
    }
    for (const out of outputs) {
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
        },
        by,
      );
    }
    if (packaging && bags > 0) {
      await supabase
        .from("packaging_types")
        .update({ current_stock: Number(packaging.current_stock) - bags })
        .eq("id", packaging.id);
      await supabase.from("packing_records").insert({
        date: batch.date,
        job_or_batch_id: batch.id,
        packaging_type_id: packaging.id,
        bags_count: bags,
        capacity_kg: packaging.capacity_kg,
        total_packed_kg: roundWeight(batch.actual_output_kg),
        packing_rate: batch.packing_rate_per_bag ?? 0,
        packing_charge: packingCharge(bags, batch.packing_rate_per_bag ?? 0),
        status: "posted",
      });
    }
    const totalInput = roundWeight(inputs.reduce((s, i) => s + i.actual_qty_kg, 0));
    const finished = outputs.find((o) => o.output_type === "finished");
    const computedYield = yieldPct(finished?.qty_kg ?? batch.actual_output_kg, totalInput);
    const variances = inputs.map((item) => ({
      product_id: item.product_id,
      ...variance(item.actual_qty_kg, item.planned_qty_kg),
    }));
    const { data: posted, error: uError } = await supabase
      .from("production_batches")
      .update({
        status: "posted",
        posted_at: new Date().toISOString(),
        actual_input_kg: totalInput,
        yield_pct: computedYield,
      })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (uError) return fail(uError.message);
    const result = { ...posted, inputs, outputs, variances, yield_pct: computedYield };
    await storeIdempotency(supabase, "batch:post", clientToken, "batch", id, batch.batch_no, result);
    revalidateProduction();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

export async function reverseBatch(id: string, reason: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A reversal reason is mandatory");
    const supabase = await createClient();
    const replay = await checkIdempotency(supabase, "batch:reverse", clientToken);
    if (replay) return replay;
    const { data: batch, error } = await supabase
      .from("production_batches")
      .select("*, production_batch_inputs(*), production_batch_outputs(*)")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
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
    // Reversal guard: outputs must still be on hand to take back.
    for (const out of outputs) {
      const available = await stockBalance(supabase, batch.godown_id, out.product_id, ownerParty);
      if (available < roundWeight(out.qty_kg)) {
        return fail(
          `Cannot reverse batch ${batch.batch_no}: output product ${out.product_id} has only ${available} kg on hand, reversal needs ${out.qty_kg} kg`,
        );
      }
    }
    const by = await createdBy(supabase);
    for (const out of outputs) {
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
        },
        by,
      );
    }
    for (const item of inputs) {
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
        },
        by,
      );
    }
    const bags = Number(batch.bags_consumed ?? 0);
    if (batch.packaging_type_id && bags > 0) {
      const { data: pkg } = await supabase
        .from("packaging_types")
        .select("current_stock")
        .eq("id", batch.packaging_type_id)
        .single();
      if (pkg) {
        await supabase
          .from("packaging_types")
          .update({ current_stock: Number(pkg.current_stock) + bags })
          .eq("id", batch.packaging_type_id);
      }
      await supabase
        .from("packing_records")
        .update({ status: "reversed" })
        .eq("job_or_batch_id", batch.id);
    }
    const { data: reversed, error: uError } = await supabase
      .from("production_batches")
      .update({ status: "reversed", reversal_reason: reason.trim(), reversed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "posted")
      .select()
      .single();
    if (uError) return fail(uError.message);
    const result = { ...reversed, inputs, outputs };
    await storeIdempotency(supabase, "batch:reverse", clientToken, "batch", id, batch.batch_no, result);
    revalidateProduction();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}
