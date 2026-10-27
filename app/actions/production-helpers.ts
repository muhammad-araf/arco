/**
 * Pure helpers for the production-gap program (spec §6, §7, §8).
 *
 * This is a plain module (NOT "use server"): server-action files may
 * only export async functions, so the synchronous totals / gating
 * logic lives here, where unit tests can import it directly.
 *
 * Charge basis (documented, not changed): a machinery job's service
 * charge stays JOB-LEVEL, applied to the job's TOTAL input weight.
 * Multi-line jobs sum every line's input first and then run the
 * existing machineryCharge() once over that total (per_bag still
 * bills the job's entered bag count, never weight / 50). Splitting
 * the charge per line would change billed amounts, so it is not done.
 *
 * By-product vs waste: by-product lines ARE stocked (produce legs on
 * post, guarded take-back on reverse). Waste is recorded on the job
 * header only and is never stocked, exactly as before.
 */

import { roundWeight } from "@/lib/calc";

export interface JobLineInput {
  inputProductId: string;
  inputQtyKg: number;
  outputProductId?: string | null;
  outputQtyKg?: number | null;
  byproductProductId?: string | null;
  byproductQtyKg?: number | null;
}

export interface JobLineTotals {
  totalInputKg: number;
  totalOutputKg: number;
  totalByproductKg: number;
}

/** Totals across every line of a multi-line job. One line = the
 *  legacy single-line job's header totals, unchanged. */
export function sumJobLines(lines: JobLineInput[]): JobLineTotals {
  return {
    totalInputKg: roundWeight(lines.reduce((s, l) => s + (Number(l.inputQtyKg) || 0), 0)),
    totalOutputKg: roundWeight(lines.reduce((s, l) => s + (Number(l.outputQtyKg) || 0), 0)),
    totalByproductKg: roundWeight(lines.reduce((s, l) => s + (Number(l.byproductQtyKg) || 0), 0)),
  };
}

/** Sum of every FINISHED output row. Yield is finished output /
 *  total input — by-product is stocked but never counted as yield,
 *  and taking only the first finished row understated multi-output
 *  batches. */
export function sumFinishedOutputs(
  outputs: { output_type?: string; qty_kg?: number }[],
): number {
  return roundWeight(
    outputs
      .filter((o) => o.output_type === "finished")
      .reduce((s, o) => s + (Number(o.qty_kg) || 0), 0),
  );
}

/**
 * Variance-tolerance gate (spec §6.4, client-confirmation value).
 * `tolerancePct` comes from the `variance_tolerance_pct` app setting
 * and is NEVER hard-coded here: null means the setting is absent and
 * the gate is disabled (current behaviour, unchanged). Otherwise a
 * batch may only post when no input's |variance %| exceeds it, or
 * when a variance reason is recorded on the batch.
 */
export function varianceExceedsTolerance(
  variances: { pct?: number }[],
  tolerancePct: number | null,
): boolean {
  if (tolerancePct === null || tolerancePct === undefined) return false;
  if (!Number.isFinite(tolerancePct) || tolerancePct < 0) return false;
  return variances.some((v) => Math.abs(Number(v.pct) || 0) > tolerancePct);
}

/** Parse the `variance_tolerance_pct` app_settings value, tolerating
 *  the shapes a settings writer might store: a bare number, or an
 *  object carrying variance_tolerance_pct / value / pct. Anything
 *  unparseable is null (gate disabled), never a guessed default. */
export function parseVarianceTolerance(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["variance_tolerance_pct", "value", "pct", "tolerance_pct"]) {
      const n = obj[key];
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
    }
  }
  return null;
}

// Minimal structural type for the Supabase client used here (the real
// client carries many more methods; `any` keeps this helper callable
// from every server action without generic-type friction).
type ProductsQuery = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * Server-side is_active guard for product selection. Returns an error
 * message, or null when every id exists and is active. A missing
 * product is also rejected here (the FK would fail later with a less
 * useful message). UI filtering alone is never trusted.
 */
export async function checkProductsActive(
  db: ProductsQuery,
  productIds: (string | null | undefined)[],
): Promise<string | null> {
  const ids = [...new Set(productIds.filter(Boolean))] as string[];
  if (!ids.length) return null;
  const { data, error } = await db
    .from("products")
    .select("id, name, is_active")
    .in("id", ids);
  if (error) return error.message;
  const byId = new Map((data ?? []).map((p) => [p.id, p]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return `Product ${id} does not exist`;
    if (row.is_active === false) {
      return `Product ${row.name ?? id} is inactive and cannot be used on a new batch or job`;
    }
  }
  return null;
}
