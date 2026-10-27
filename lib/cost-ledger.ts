/**
 * Production cost-ledger writes (wave 2, gated).
 *
 * Plain module (NOT "use server"): the write helper is imported by
 * postBatch / postJob, and a "use server" file may only export async
 * functions. The server action itself lives in
 * app/actions/cost-ledger.ts and wraps writeCostLedgerRows().
 *
 * Gating: cost_ledger_enabled app_settings key, default false. When
 * disabled (or the row is absent/unparseable) NO rows are written —
 * current behaviour is preserved exactly.
 *
 * Money: ingredient amounts come only from the configured
 * valuation_method via the finance team's pure computeStockValuation()
 * (import only, never edited). When the method is 'unconfirmed' (or
 * anything else unrecognised) quantities are recorded with NULL amount
 * and basis 'unconfirmed-method' — no costing method is ever invented.
 * A product with no purchase history under a set method likewise gets
 * NULL amount (uncosted, not free).
 */

import { computeStockValuation } from "./calc/finance-valuation";

export interface CostLedgerEntry {
  batchId?: string | null;
  jobId?: string | null;
  costType: string;
  amount?: number | null;
  qtyKg?: number | null;
  basis?: string | null;
}

type DbLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    insert: (
      rows: Record<string, unknown>[],
    ) => Promise<{ error: { message: string } | null }>;
  };
};

async function readSettingRow(
  db: DbLike,
  key: string,
): Promise<unknown | null> {
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { value?: unknown }).value ?? null;
  } catch {
    return null;
  }
}

/** True only when the cost_ledger_enabled row is literally true. */
export async function isCostLedgerEnabled(db: DbLike): Promise<boolean> {
  return (await readSettingRow(db, "cost_ledger_enabled")) === true;
}

/** Configured valuation method, or 'unconfirmed' when absent/unknown. */
export async function getValuationMethod(db: DbLike): Promise<string> {
  const v = await readSettingRow(db, "valuation_method");
  return typeof v === "string" && v.trim() ? v.trim() : "unconfirmed";
}

/**
 * Unit cost per product id under the configured method, from posted +
 * received purchase history (same source getStockValuation reads).
 * Returns null per product when the method is unconfirmed or the
 * product has no purchase history.
 */
export async function ingredientUnitCosts(
  db: DbLike,
  productIds: string[],
  method: string,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(
    productIds.map((id) => [id, null]),
  );
  if (method !== "last_purchase_cost" && method !== "average_cost") {
    return out;
  }
  try {
    // The supabase query builder's chaining is runtime-typed; cast to
    // a loose client here so this plain helper stays build-safe.
    const client = db as unknown as {
      from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const posted = await client
      .from("purchases")
      .select("id, date")
      .eq("status", "posted")
      .eq("receipt_status", "received");
    const postedRows = (posted as { data?: unknown }).data as
      | { id: string; date: string }[]
      | null;
    const postedIds = new Set((postedRows ?? []).map((p) => String(p.id)));
    const dateById = new Map(
      (postedRows ?? []).map((p) => [String(p.id), String(p.date ?? "")]),
    );
    const linesRes = await client
      .from("purchase_items")
      .select("purchase_id, product_id, quantity, unit_price")
      .eq("item_type", "seed");
    const lines = (linesRes as { data?: unknown }).data as
      | {
          purchase_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
        }[]
      | null;
    const purchases = (lines ?? [])
      .filter(
        (l) => postedIds.has(String(l.purchase_id)) && l.product_id,
      )
      .map((l) => ({
        productId: String(l.product_id),
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unit_price) || 0,
        date: dateById.get(String(l.purchase_id)) ?? "",
      }));
    const result = computeStockValuation(
      productIds.map((productId) => ({ productId, closingQty: 1 })),
      purchases,
      method,
    );
    if (result.status === "valued") {
      for (const row of result.rows) {
        out.set(row.productId, row.unitCost);
      }
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * Insert cost rows, honouring the gate. Returns false (and writes
 * nothing) when the gate is off; callers treat a false as "not
 * enabled", never as an error. Insert failures are returned as an
 * error string so the caller can log them without failing its post.
 */
export async function writeCostLedgerRows(
  db: DbLike,
  entries: CostLedgerEntry[],
): Promise<{ ok: boolean; error?: string }> {
  if (!entries.length) return { ok: true };
  if (!(await isCostLedgerEnabled(db))) return { ok: false };
  const rows = entries.map((e) => ({
    batch_id: e.batchId ?? null,
    job_id: e.jobId ?? null,
    cost_type: e.costType,
    amount: e.amount ?? null,
    qty_kg: e.qtyKg ?? null,
    basis: e.basis ?? null,
  }));
  const { error } = await db.from("production_cost_ledger").insert(rows);
  if (error) return { ok: false, error: (error as { message: string }).message };
  return { ok: true };
}
