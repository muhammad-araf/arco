"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireSignedIn, type Actor } from "./auth";
import { MACHINERY_WRITE } from "./auth-helpers";
import {
  roundWeight,
  stockBalanceFromRows,
  machineryCharge,
} from "@/lib/calc";
import type { RateBasis } from "@/lib/types/database";
import { callAtomicStockTransition } from "@/lib/atomic";
import { writeCostLedgerRows } from "@/lib/cost-ledger";
import { logAudit } from "@/lib/audit";
import {
  checkProductsActive,
  sumJobLines,
  type JobLineInput,
} from "./production-helpers";

/**
 * Machinery / service-job server actions (spec §7).
 *
 * Flow: createJobDraft -> postJob -> reverseJob(reason).
 *
 * Posting (exactly once, status guard + clientToken):
 *   1. Keeps the service charge computed at draft time with
 *      machineryCharge() for the job's rate basis — per_bag bills
 *      the ACTUAL bag count entered on the job (never weight / 50),
 *      per_50kg / per_kg / per_maund bill kg, fixed returns the
 *      rate, and per_maund REQUIRES the explicit client-approved
 *      maundKg (no universal maund value is assumed anywhere).
 *      The bag count and maundKg are stored on the job
 *      (machinery_jobs.bags / maund_kg), so the stored charge is
 *      recomputable and auditable after posting. Posting preserves
 *      the draft-time charge rather than recomputing it, so a job
 *      created before these columns existed keeps its recorded
 *      charge instead of being silently rebilled from missing inputs.
 *   2. Stock-guards and consumes the input, and adds the output, in
 *      the job's godown via stock_ledger rows. Waste is recorded on
 *      the job but NEVER added to stock.
 *   3. Party scoping (the owner rule): when is_customer_owned is set,
 *      the owner is the job's customer_id. Input is consumed from the
 *      OWNER's stock pool and output is credited to the OWNER's pool —
 *      company-owned stock (party_id NULL) is never touched. When the
 *      job is a company job, input is consumed from company stock
 *      (party_id NULL, guarded) and output is credited to company
 *      stock.
 *   4. The posted service_charge IS the customer charge record: it
 *      lives on the job and is what billing reads. Posting does NOT
 *      create an invoice and does NOT post a receipt — billing the
 *      charge is a separate step via createInvoice() in
 *      app/actions/finance.ts with sourceType "machinery_job" and
 *      sourceId = the job id (spec §11.1: the accountant may prepare
 *      a combined invoice instead of one per job). There is no
 *      standalone customer-charge table in the schema to write to,
 *      and invoice_lines requires an invoice_id, so inventing a row
 *      there would be wrong.
 *
 * Reversal (mandatory reason) writes the mirror ledger rows and
 * flips the job to reversed. It does not touch any invoice: if the
 * charge was already billed separately, that invoice must be
 * reversed through the finance actions as well.
 *
 * Multi-line jobs: machinery_job_lines carries one row per line
 * (input / output / by-product per line). A job WITH lines posts and
 * reverses from its lines; a job WITHOUT lines posts from its header
 * exactly as before (one line = current behaviour). The service
 * charge stays job-level: machineryCharge() runs once over the job's
 * TOTAL input weight (per_bag bills the job's bag count). By-product
 * lines ARE stocked; waste is header-only and never stocked.
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
function revalidateMachinery(): void {
  revalidatePath("/machinery");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

async function requireWrite(
  db: Db,
): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireRole(db, MACHINERY_WRITE);
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

export interface JobLineDraftInput {
  inputProductId: string;
  inputQtyKg: number;
  outputProductId?: string;
  outputQtyKg?: number;
  byproductProductId?: string;
  byproductQtyKg?: number;
}

export interface CreateJobDraftInput {
  customerId: string;
  machineId: string;
  godownId: string;
  processingType: string;
  inputProductId: string;
  inputWeightKg: number;
  outputProductId?: string;
  outputWeightKg?: number;
  wasteWeightKg?: number;
  /** Operator who ran the job (free text, no operator master exists). */
  operatorName?: string;
  /** Single-line job's by-product, stocked on post like a line by-product. */
  byproductProductId?: string;
  byproductWeightKg?: number;
  /** Multi-line jobs: when supplied, the header totals/charge derive
   *  from these lines and the lines are what posts. When omitted, the
   *  legacy single-line header path runs exactly as before. */
  lines?: JobLineDraftInput[];
  /** Bag count — required when rateBasis is per_bag (that basis bills bags). */
  bags?: number;
  rateBasis: RateBasis;
  rate: number;
  /** Required when rateBasis is per_maund: client-approved kg per maund. */
  maundKg?: number;
  isCustomerOwned?: boolean;
  date?: string;
  notes?: string;
}

// ---------------- Reads ----------------
export async function listJobs(filters?: {
  status?: string;
  customerId?: string;
  machineId?: string;
  godownId?: string;
  from?: string;
  to?: string;
}): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    let query = supabase.from("machinery_jobs").select("*, machinery_job_lines(*)").order("date", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.customerId) query = query.eq("customer_id", filters.customerId);
    if (filters?.machineId) query = query.eq("machine_id", filters.machineId);
    if (filters?.godownId) query = query.eq("godown_id", filters.godownId);
    if (filters?.from) query = query.gte("date", filters.from);
    if (filters?.to) query = query.lte("date", filters.to);
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(sortJobLines(data));
  } catch (e) {
    return fail(errMessage(e));
  }
}

/** Job lines ordered by line_no (PostgREST nested order is not relied
 *  on — the action sorts, so the page and print always see line order). */
function sortJobLines(jobs: unknown): unknown {
  if (!Array.isArray(jobs)) return jobs;
  return jobs.map((job: Record<string, unknown>) => {
    const lines = job.machinery_job_lines;
    if (!Array.isArray(lines)) return job;
    return {
      ...job,
      machinery_job_lines: [...lines].sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          Number(a.line_no ?? 0) - Number(b.line_no ?? 0),
      ),
    };
  });
}

export async function getJob(id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase.from("machinery_jobs").select("*, machinery_job_lines(*)").eq("id", id).single();
    if (error) return fail(error.message);
    return ok((sortJobLines([data]) as unknown[])[0]);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Draft ----------------
export async function createJobDraft(input: CreateJobDraftInput): Promise<ActionResult> {
  try {
    if (!input?.customerId || !input?.machineId || !input?.godownId) {
      return fail("customerId, machineId and godownId are required");
    }
    if (!input?.processingType?.trim()) return fail("processingType is required");
    if (!input?.inputProductId) return fail("inputProductId is required");
    // Multi-line totals (one line = the legacy header values). The
    // charge is computed ONCE over the job's total input weight —
    // never per line (see production-helpers.ts).
    const lines: JobLineInput[] | null = input.lines?.length
      ? input.lines.map((l) => ({
          inputProductId: l.inputProductId,
          inputQtyKg: l.inputQtyKg,
          outputProductId: l.outputProductId ?? null,
          outputQtyKg: l.outputQtyKg ?? 0,
          byproductProductId: l.byproductProductId ?? null,
          byproductQtyKg: l.byproductQtyKg ?? 0,
        }))
      : null;
    let totalInput = input.inputWeightKg;
    let totalOutput = input.outputWeightKg ?? 0;
    let totalByproduct = input.byproductWeightKg ?? 0;
    if (lines) {
      for (const line of lines) {
        if (!line.inputProductId) return fail("Every job line needs an input product");
        if (line.inputQtyKg < 0 || (line.outputQtyKg ?? 0) < 0 || (line.byproductQtyKg ?? 0) < 0) {
          return fail("Job line quantities cannot be negative");
        }
      }
      const totals = sumJobLines(lines);
      totalInput = totals.totalInputKg;
      totalOutput = totals.totalOutputKg;
      totalByproduct = totals.totalByproductKg;
    }
    if (!(totalInput > 0)) return fail("inputWeightKg must be > 0");
    if (totalOutput < 0 || (input.wasteWeightKg ?? 0) < 0 || totalByproduct < 0) {
      return fail("Output, by-product and waste weights cannot be negative");
    }
    if (totalOutput + totalByproduct + (input.wasteWeightKg ?? 0) > totalInput) {
      return fail("Output + by-product + waste exceeds input weight");
    }
    if (input.rate < 0) return fail("rate cannot be negative");
    if (input.rateBasis === "per_bag" && !(input.bags !== undefined && input.bags >= 0)) {
      return fail("bags (bag count) is required when rateBasis is per_bag");
    }
    if (input.bags !== undefined && (!Number.isFinite(input.bags) || input.bags < 0)) {
      return fail("bags cannot be negative");
    }
    if (input.maundKg !== undefined && (!Number.isFinite(input.maundKg) || input.maundKg <= 0)) {
      return fail("maundKg must be greater than zero when supplied");
    }
    let charge: number;
    try {
      // Job-level charge: per_bag bills the job's bag count; every
      // other basis bills the TOTAL input weight across all lines.
      charge = machineryCharge(
        input.rateBasis === "per_bag" ? (input.bags ?? 0) : totalInput,
        input.rateBasis,
        input.rate,
        input.maundKg,
      );
    } catch (e) {
      return fail(errMessage(e));
    }
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    // Server-side is_active check on every selected product.
    const activeError = await checkProductsActive(supabase, [
      input.inputProductId,
      input.outputProductId,
      input.byproductProductId,
      ...(lines ?? []).flatMap((l) => [l.inputProductId, l.outputProductId, l.byproductProductId]),
    ]);
    if (activeError) return fail(activeError);
    const jobNo = await nextDocNumber(supabase, "machinery", "JOB");
    // Header keeps job-level totals so list views keep working; the
    // first line's products stay the header products for a multi-line
    // job (the lines themselves are the detail).
    const firstLine = lines?.[0];
    const { data: job, error } = await supabase
      .from("machinery_jobs")
      .insert({
        job_no: jobNo,
        date: input.date ?? new Date().toISOString(),
        customer_id: input.customerId,
        machine_id: input.machineId,
        godown_id: input.godownId,
        processing_type: input.processingType.trim(),
        operator_name: input.operatorName?.trim() || null,
        input_product_id: firstLine?.inputProductId ?? input.inputProductId,
        input_weight_kg: roundWeight(totalInput),
        output_product_id: firstLine?.outputProductId ?? input.outputProductId ?? null,
        output_weight_kg: roundWeight(totalOutput),
        byproduct_product_id: firstLine?.byproductProductId ?? input.byproductProductId ?? null,
        byproduct_weight_kg: roundWeight(totalByproduct),
        waste_weight_kg: roundWeight(input.wasteWeightKg ?? 0),
        // Stored (not echoed): the charge inputs, so the posted
        // charge can be recomputed and audited later.
        bags: input.bags ?? null,
        maund_kg: input.maundKg ?? null,
        rate_basis: input.rateBasis,
        rate: input.rate,
        service_charge: charge,
        is_customer_owned: input.isCustomerOwned ?? false,
        status: "draft",
        notes: input.notes ?? null,
        created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (error) return fail(error.message);
    if (lines) {
      const { error: lError } = await supabase.from("machinery_job_lines").insert(
        lines.map((line, i) => ({
          job_id: job.id,
          line_no: i,
          input_product_id: line.inputProductId,
          input_qty_kg: roundWeight(line.inputQtyKg),
          output_product_id: line.outputProductId ?? null,
          output_qty_kg: roundWeight(line.outputQtyKg ?? 0),
          byproduct_product_id: line.byproductProductId ?? null,
          byproduct_qty_kg: roundWeight(line.byproductQtyKg ?? 0),
        })),
      );
      if (lError) {
        await supabase.from("machinery_jobs").delete().eq("id", job.id);
        return fail(lError.message);
      }
    }
    revalidateMachinery();
    return ok(job);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Draft delete (orphan drafts) ----------------
/** Delete a job that never posted (e.g. its post failed). Posted and
 * reversed jobs are never deleted — they reverse, with a reason. */
export async function deleteJobDraft(id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const { data, error } = await supabase
      .from("machinery_jobs")
      .delete()
      .eq("id", id)
      .eq("status", "draft")
      .select("id")
      .single();
    if (error || !data) return fail("Only a draft job can be deleted");
    revalidateMachinery();
    return ok({ id });
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Post ----------------
/** Cost-ledger (wave 2, gated, best-effort): the posted job's stored
 * service_charge, recorded against the job's own charge basis
 * (rate_basis). When cost_ledger_enabled is off this writes nothing;
 * a ledger failure is logged, never a reason to fail a job that
 * already posted. */
async function recordJobCost(
  supabase: Db,
  job: { id: string; service_charge?: number | null; rate_basis?: string | null },
  inputKg: number,
): Promise<void> {
  try {
    const res = await writeCostLedgerRows(
      supabase as unknown as Parameters<typeof writeCostLedgerRows>[0],
      [
        {
          jobId: job.id,
          costType: "processing",
          amount: Number(job.service_charge ?? 0),
          qtyKg: roundWeight(inputKg),
          basis: job.rate_basis ?? null,
        },
      ],
    );
    if (res.error) {
      console.error("[cost-ledger] job cost write failed:", res.error);
    }
  } catch (costErr) {
    console.error("[cost-ledger] job cost write failed:", costErr);
  }
}

export async function postJob(id: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "machinery:post", clientToken);
    if (replay) return replay;
    const { data: job, error } = await supabase.from("machinery_jobs").select("*, machinery_job_lines(*)").eq("id", id).single();
    if (error) return fail(error.message);
    // Already posted is a successful replay, not a second posting.
    if (job.status === "posted") return ok(job);
    if (job.status !== "draft") return fail(`Only a draft can be posted (status: ${job.status})`);
    if (!job.godown_id) return fail(`Job ${job.job_no} has no godown, so its stock cannot be posted`);
    // Charge is fixed at draft time (see header note). The stored
    // bags / maund_kg let anyone recompute it afterwards; posting
    // preserves the stored service_charge as the charge record.
    const ownerParty: string | null = job.is_customer_owned ? job.customer_id : null;
    const storedLines = (Array.isArray(job.machinery_job_lines) ? job.machinery_job_lines : [])
      .slice()
      .sort((a: { line_no?: number }, b: { line_no?: number }) => Number(a.line_no ?? 0) - Number(b.line_no ?? 0));
    // Multi-line job: every line's input is guarded (aggregated per
    // product + owner pool, so duplicate lines cannot each pass
    // against the same balance) and every line's output AND by-product
    // is stocked. Waste stays header-only, never stocked.
    if (storedLines.length > 0) {
      const needByKey = new Map<string, { productId: string; qty: number }>();
      for (const line of storedLines) {
        const qty = roundWeight(Number(line.input_qty_kg ?? 0));
        if (qty <= 0) continue;
        const key = `${line.input_product_id}|${ownerParty ?? ""}`;
        const cur = needByKey.get(key);
        needByKey.set(key, { productId: line.input_product_id, qty: (cur?.qty ?? 0) + qty });
      }
      for (const need of needByKey.values()) {
        const available = await stockBalance(supabase, job.godown_id, need.productId, ownerParty);
        if (available < roundWeight(need.qty)) {
          return fail(
            `Insufficient stock for job ${job.job_no}: product ${need.productId} has ${available} kg available in this godown${ownerParty ? " for this owner" : ""}, job needs ${need.qty} kg`,
          );
        }
      }
      const multiLegs: {
        lineNo: number; godownId: string; productId: string; partyId: string | null; inwardQty: number; outwardQty: number;
      }[] = [];
      for (const line of storedLines) {
        const qty = roundWeight(Number(line.input_qty_kg ?? 0));
        if (qty > 0) {
          multiLegs.push({
            lineNo: multiLegs.length, godownId: job.godown_id, productId: line.input_product_id,
            partyId: ownerParty, inwardQty: 0, outwardQty: qty,
          });
        }
      }
      for (const line of storedLines) {
        const qty = roundWeight(Number(line.output_qty_kg ?? 0));
        if (line.output_product_id && qty > 0) {
          multiLegs.push({
            lineNo: multiLegs.length, godownId: job.godown_id, productId: line.output_product_id,
            partyId: ownerParty, inwardQty: qty, outwardQty: 0,
          });
        }
      }
      for (const line of storedLines) {
        const qty = roundWeight(Number(line.byproduct_qty_kg ?? 0));
        if (line.byproduct_product_id && qty > 0) {
          multiLegs.push({
            lineNo: multiLegs.length, godownId: job.godown_id, productId: line.byproduct_product_id,
            partyId: ownerParty, inwardQty: qty, outwardQty: 0,
          });
        }
      }
      const multi = await callAtomicStockTransition(supabase, {
        voucherTable: "machinery_jobs",
        voucherId: id,
        fromStatuses: ["draft"],
        toStatus: "posted",
        voucherType: "machinery",
        voucherNo: job.job_no,
        entryKind: "post",
        lines: multiLegs,
        createdBy: gate.actor.userId,
        clientToken: clientToken ?? null,
        scope: "machinery:post",
      });
      if (!multi.ok) return fail(multi.error);
      if (multi.result.outcome === "invalid") {
        return fail(`Only a draft can be posted (status: ${multi.result.status})`);
      }
      const postedMulti = multi.result.voucher as Record<string, unknown>;
      const resultMulti = { ...postedMulti, service_charge: Number(postedMulti.service_charge ?? 0) };
      await logAudit(supabase, {
        action: "post",
        entityType: "machinery_job",
        entityId: id,
        voucherNo: job.job_no,
        before: { status: "draft" },
        after: { status: "posted", lines: storedLines.length },
        userId: gate.actor.userId,
        userEmail: gate.actor.email,
      });
      await recordJobCost(
        supabase,
        { id, service_charge: Number(postedMulti.service_charge ?? job.service_charge ?? 0), rate_basis: job.rate_basis ?? null },
        storedLines.reduce(
          (sum: number, l: { input_qty_kg?: number | null }) =>
            sum + roundWeight(Number(l.input_qty_kg ?? 0)),
          0,
        ),
      );
      revalidateMachinery();
      return ok(resultMulti);
    }
    const inputQty = roundWeight(Number(job.input_weight_kg ?? 0));
    const outputQty = roundWeight(Number(job.output_weight_kg ?? 0));
    const byproductQty = roundWeight(Number(job.byproduct_weight_kg ?? 0));
    // Stock guard on the input, scoped to the owner's pool. A
    // customer-owned job guards ONLY the owner's balance and never
    // the company (NULL-party) balance; a company job guards company
    // stock. Aggregated here because the job has a single input line.
    const available = await stockBalance(supabase, job.godown_id, job.input_product_id, ownerParty);
    if (available < inputQty) {
      return fail(
        `Insufficient stock for job ${job.job_no}: product ${job.input_product_id} has ${available} kg available in this godown${ownerParty ? " for this owner" : ""}, job needs ${inputQty} kg`,
      );
    }
    // Atomic post (B4): input + output legs + flip + key in one
    // transaction via atomic_stock_transition (see inward.ts).
    // Waste is recorded on the job header only; it is never stocked.
    // A single-line job's by-product IS stocked (like a line by-product).
    const jobLines = [
      {
        lineNo: 0,
        godownId: job.godown_id,
        productId: job.input_product_id,
        partyId: ownerParty,
        inwardQty: 0,
        outwardQty: inputQty,
      },
    ];
    if (job.output_product_id && outputQty > 0) {
      jobLines.push({
        lineNo: 1,
        godownId: job.godown_id,
        productId: job.output_product_id,
        // Output of a customer-owned job belongs to the owner, not
        // the company — same party scope as the input.
        partyId: ownerParty,
        inwardQty: outputQty,
        outwardQty: 0,
      });
    }
    if (job.byproduct_product_id && byproductQty > 0) {
      jobLines.push({
        lineNo: jobLines.length,
        godownId: job.godown_id,
        productId: job.byproduct_product_id,
        partyId: ownerParty,
        inwardQty: byproductQty,
        outwardQty: 0,
      });
    }
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "machinery_jobs",
      voucherId: id,
      fromStatuses: ["draft"],
      toStatus: "posted",
      voucherType: "machinery",
      voucherNo: job.job_no,
      entryKind: "post",
      lines: jobLines,
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "machinery:post",
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a draft can be posted (status: ${transition.result.status})`);
    }
    const posted = transition.result.voucher as Record<string, unknown>;
    // No invoice and no receipt are created here: the service_charge
    // on this posted job is the charge record billing reads later
    // (createInvoice, sourceType "machinery_job", sourceId = job id).
    const result = { ...posted, service_charge: Number(posted.service_charge ?? 0) };
    await logAudit(supabase, {
      action: "post",
      entityType: "machinery_job",
      entityId: id,
      voucherNo: job.job_no,
      before: { status: "draft" },
      after: { status: "posted" },
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    await recordJobCost(
      supabase,
      { id, service_charge: Number(posted.service_charge ?? job.service_charge ?? 0), rate_basis: job.rate_basis ?? null },
      inputQty,
    );
    revalidateMachinery();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Reverse ----------------
export async function reverseJob(id: string, reason: string, clientToken?: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    if (!reason?.trim()) return fail("A reversal reason is mandatory");
    const supabase = await createClient();
    const gate = await requireWrite(supabase);
    if ("error" in gate) return fail(gate.error);
    const replay = await checkIdempotency(supabase, "machinery:reverse", clientToken);
    if (replay) return replay;
    const { data: job, error } = await supabase.from("machinery_jobs").select("*, machinery_job_lines(*)").eq("id", id).single();
    if (error) return fail(error.message);
    // Already reversed is a successful replay, not a second reversal.
    if (job.status === "reversed") return ok(job);
    if (job.status !== "posted") {
      return fail(`Only a posted job can be reversed (status: ${job.status})`);
    }
    if (!job.godown_id) return fail(`Job ${job.job_no} has no godown, so its stock cannot be reversed`);
    const ownerParty: string | null = job.is_customer_owned ? job.customer_id : null;
    const storedLines = (Array.isArray(job.machinery_job_lines) ? job.machinery_job_lines : [])
      .slice()
      .sort((a: { line_no?: number }, b: { line_no?: number }) => Number(a.line_no ?? 0) - Number(b.line_no ?? 0));
    // Multi-line reversal: outputs AND by-products must still be on
    // hand (aggregated per product + owner pool) before they are taken
    // back; inputs are then restored line by line.
    if (storedLines.length > 0) {
      const takeBack = new Map<string, { productId: string; qty: number }>();
      const addTakeBack = (productId: string | null, qty: number) => {
        if (!productId || qty <= 0) return;
        const key = `${productId}|${ownerParty ?? ""}`;
        const cur = takeBack.get(key);
        takeBack.set(key, { productId, qty: (cur?.qty ?? 0) + qty });
      };
      for (const line of storedLines) {
        addTakeBack(line.output_product_id, roundWeight(Number(line.output_qty_kg ?? 0)));
        addTakeBack(line.byproduct_product_id, roundWeight(Number(line.byproduct_qty_kg ?? 0)));
      }
      for (const need of takeBack.values()) {
        const available = await stockBalance(supabase, job.godown_id, need.productId, ownerParty);
        if (available < roundWeight(need.qty)) {
          return fail(
            `Cannot reverse job ${job.job_no}: product ${need.productId} has only ${available} kg on hand, reversal needs ${need.qty} kg`,
          );
        }
      }
      const multiReverse: {
        lineNo: number; godownId: string; productId: string; partyId: string | null;
        inwardQty: number; outwardQty: number; notes?: string;
      }[] = [];
      for (const line of storedLines) {
        const outQty = roundWeight(Number(line.output_qty_kg ?? 0));
        if (line.output_product_id && outQty > 0) {
          multiReverse.push({
            lineNo: multiReverse.length, godownId: job.godown_id, productId: line.output_product_id,
            partyId: ownerParty, inwardQty: 0, outwardQty: outQty,
            notes: `Reversal of ${job.job_no}: ${reason.trim()}`,
          });
        }
        const byQty = roundWeight(Number(line.byproduct_qty_kg ?? 0));
        if (line.byproduct_product_id && byQty > 0) {
          multiReverse.push({
            lineNo: multiReverse.length, godownId: job.godown_id, productId: line.byproduct_product_id,
            partyId: ownerParty, inwardQty: 0, outwardQty: byQty,
            notes: `Reversal of ${job.job_no}: ${reason.trim()}`,
          });
        }
      }
      for (const line of storedLines) {
        const inQty = roundWeight(Number(line.input_qty_kg ?? 0));
        if (inQty > 0) {
          multiReverse.push({
            lineNo: multiReverse.length, godownId: job.godown_id, productId: line.input_product_id,
            partyId: ownerParty, inwardQty: inQty, outwardQty: 0,
            notes: `Reversal of ${job.job_no}: ${reason.trim()}`,
          });
        }
      }
      const multi = await callAtomicStockTransition(supabase, {
        voucherTable: "machinery_jobs",
        voucherId: id,
        fromStatuses: ["posted"],
        toStatus: "reversed",
        voucherType: "machinery",
        voucherNo: job.job_no,
        entryKind: "reversal",
        lines: multiReverse,
        createdBy: gate.actor.userId,
        clientToken: clientToken ?? null,
        scope: "machinery:reverse",
        reversalReason: reason.trim(),
      });
      if (!multi.ok) return fail(multi.error);
      if (multi.result.outcome === "invalid") {
        return fail(`Only a posted job can be reversed (status: ${multi.result.status})`);
      }
      const reversedMulti = multi.result.voucher as Record<string, unknown>;
      await logAudit(supabase, {
        action: "reverse",
        entityType: "machinery_job",
        entityId: id,
        voucherNo: job.job_no,
        before: { status: "posted" },
        after: { status: "reversed" },
        reason: reason.trim(),
        userId: gate.actor.userId,
        userEmail: gate.actor.email,
      });
      revalidateMachinery();
      return ok({ ...reversedMulti });
    }
    const inputQty = roundWeight(Number(job.input_weight_kg ?? 0));
    const outputQty = roundWeight(Number(job.output_weight_kg ?? 0));
    const byproductQty = roundWeight(Number(job.byproduct_weight_kg ?? 0));
    // Reversal guard: the output (and by-product) must still be on
    // hand (same party scope) before it can be taken back.
    if (job.output_product_id && outputQty > 0) {
      const available = await stockBalance(supabase, job.godown_id, job.output_product_id, ownerParty);
      if (available < outputQty) {
        return fail(
          `Cannot reverse job ${job.job_no}: output product ${job.output_product_id} has only ${available} kg on hand, reversal needs ${outputQty} kg`,
        );
      }
    }
    if (job.byproduct_product_id && byproductQty > 0) {
      const available = await stockBalance(supabase, job.godown_id, job.byproduct_product_id, ownerParty);
      if (available < byproductQty) {
        return fail(
          `Cannot reverse job ${job.job_no}: by-product ${job.byproduct_product_id} has only ${available} kg on hand, reversal needs ${byproductQty} kg`,
        );
      }
    }
    // Atomic reversal (B4): mirror legs + flip + key, one transaction.
    const reverseLines = [];
    if (job.output_product_id && outputQty > 0) {
      reverseLines.push({
        lineNo: 0,
        godownId: job.godown_id,
        productId: job.output_product_id,
        partyId: ownerParty,
        inwardQty: 0,
        outwardQty: outputQty,
        notes: `Reversal of ${job.job_no}: ${reason.trim()}`,
      });
    }
    if (job.byproduct_product_id && byproductQty > 0) {
      reverseLines.push({
        lineNo: reverseLines.length,
        godownId: job.godown_id,
        productId: job.byproduct_product_id,
        partyId: ownerParty,
        inwardQty: 0,
        outwardQty: byproductQty,
        notes: `Reversal of ${job.job_no}: ${reason.trim()}`,
      });
    }
    reverseLines.push({
      lineNo: reverseLines.length,
      godownId: job.godown_id,
      productId: job.input_product_id,
      partyId: ownerParty,
      inwardQty: inputQty,
      outwardQty: 0,
      notes: `Reversal of ${job.job_no}: ${reason.trim()}`,
    });
    const transition = await callAtomicStockTransition(supabase, {
      voucherTable: "machinery_jobs",
      voucherId: id,
      fromStatuses: ["posted"],
      toStatus: "reversed",
      voucherType: "machinery",
      voucherNo: job.job_no,
      entryKind: "reversal",
      lines: reverseLines,
      createdBy: gate.actor.userId,
      clientToken: clientToken ?? null,
      scope: "machinery:reverse",
      reversalReason: reason.trim(),
    });
    if (!transition.ok) return fail(transition.error);
    if (transition.result.outcome === "invalid") {
      return fail(`Only a posted job can be reversed (status: ${transition.result.status})`);
    }
    const reversed = transition.result.voucher as Record<string, unknown>;
    const result = { ...reversed };
    await logAudit(supabase, {
      action: "reverse",
      entityType: "machinery_job",
      entityId: id,
      voucherNo: job.job_no,
      before: { status: "posted" },
      after: { status: "reversed" },
      reason: reason.trim(),
      userId: gate.actor.userId,
      userEmail: gate.actor.email,
    });
    revalidateMachinery();
    return ok(result);
  } catch (e) {
    return fail(errMessage(e));
  }
}
