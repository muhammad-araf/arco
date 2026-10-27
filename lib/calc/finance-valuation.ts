/**
 * Finance valuation helpers (spec §10–§12, §15) — pure functions only,
 * no DB access, so they are unit-testable in isolation (see
 * tests/unit/finance-valuation.test.ts).
 *
 * NOTHING here invents a costing method:
 * - Bardana valuation is only the sum of the total_cost values already
 *   recorded on bardana_ledger rows. Consumption rows usually carry no
 *   unit_cost, so this sum is NOT a closing-stock valuation and is
 *   always returned with BARDANA_VALUATION_LABEL saying so.
 * - Stock valuation takes the method as an argument (the caller passes
 *   the accountant-confirmed method from the app_settings pl_config
 *   key); "unconfirmed" (or anything else unrecognised) returns a
 *   method-not-set result with NO number, never a guessed value.
 */

import { roundMoney } from "./money";

/** Label carried with every bardana valuation sum. */
export const BARDANA_VALUATION_LABEL =
  "Sum of recorded bardana_ledger.total_cost values only — not a costing-method valuation (consumption rows usually carry no unit_cost).";

/**
 * Genuine bardana consumption voucher types (spec §15.1: packaging cost
 * is consumed-bag cost ONLY). Allow-list, not a block-list: any other
 * out-row type is excluded by default. In particular:
 * - "purchase" rows are in-rows, never consumption;
 * - "purchase_return" / "purchase_reversal" out-rows return or unwind
 *   bags, they do not consume them;
 * - "packing_reversal" / "batch_packing_reversal" rows are in-rows
 *   restoring bags, never consumption.
 * Only "packing" (standalone packing) and "batch_packing" (batch
 * packing) write genuine consumption out-rows.
 */
export const PACKAGING_CONSUMPTION_VOUCHER_TYPES = [
  "batch_packing",
  "packing",
] as const;

export type PackagingConsumptionVoucherType =
  (typeof PACKAGING_CONSUMPTION_VOUCHER_TYPES)[number];

export function isPackagingConsumptionVoucherType(
  voucherType: unknown,
): voucherType is PackagingConsumptionVoucherType {
  return (
    typeof voucherType === "string" &&
    (PACKAGING_CONSUMPTION_VOUCHER_TYPES as readonly string[]).includes(
      voucherType,
    )
  );
}

export interface BardanaValuationRow {
  in_qty?: number | null;
  out_qty?: number | null;
  total_cost?: number | null;
}

/**
 * Sum recorded bardana costs over a set of ledger rows.
 * inCost = sum of total_cost on rows with in_qty > 0 (purchases and
 * reversals restoring bags); outCost = sum on rows with out_qty > 0
 * (consumption rows that happened to carry a cost); net = in − out.
 * Rows with no total_cost contribute 0 — they are uncosted, not free.
 */
export function bardanaValuation(rows: BardanaValuationRow[]): {
  inCost: number;
  outCost: number;
  netRecordedCost: number;
  label: string;
} {
  let inCost = 0;
  let outCost = 0;
  for (const r of rows) {
    const cost = Number(r.total_cost) || 0;
    if ((Number(r.in_qty) || 0) > 0) inCost = roundMoney(inCost + cost);
    if ((Number(r.out_qty) || 0) > 0) outCost = roundMoney(outCost + cost);
  }
  return {
    inCost,
    outCost,
    netRecordedCost: roundMoney(inCost - outCost),
    label: BARDANA_VALUATION_LABEL,
  };
}

/** Methods getStockValuation accepts. Anything else is method-not-set. */
export type StockValuationMethod =
  | "last_purchase_cost"
  | "average_cost"
  | "unconfirmed";

export interface StockValuationProductInput {
  productId: string;
  /** Closing stock quantity from stock_ledger (inward − outward). */
  closingQty: number;
}

export interface StockValuationPurchaseInput {
  productId: string;
  /** Received quantity on a posted, received purchase line. */
  quantity: number;
  unitPrice: number;
  /** Purchase date (ISO); latest wins for last_purchase_cost. */
  date: string;
}

export interface StockValuationRow {
  productId: string;
  closingQty: number;
  /** Unit cost under the chosen method, or null when no purchase history. */
  unitCost: number | null;
  /** closingQty × unitCost, or null when unitCost is null. */
  value: number | null;
}

export type StockValuationResult =
  | {
      method: StockValuationMethod;
      status: "valued";
      rows: StockValuationRow[];
      /** Sum of row values for rows that have a cost; null rows excluded. */
      totalValue: number;
      /** Product ids with stock on hand but no purchase history. */
      uncostedProductIds: string[];
    }
  | {
      method: string;
      status: "method_not_set";
      message: string;
      rows: [];
      totalValue: null;
      uncostedProductIds: [];
    };

/**
 * Product stock value from purchase history, per the method argument.
 *
 * - last_purchase_cost: value = closingQty × unit price of the most
 *   recent posted, received purchase line for that product.
 * - average_cost: value = closingQty × weighted-average unit price,
 *   where the average = Σ(qty × price) / Σ(qty) over all posted,
 *   received purchase lines for that product.
 *
 * Only products with closingQty > 0 are valued. A product with stock
 * but no purchase history gets unitCost/value null and is listed in
 * uncostedProductIds — it is never valued at 0, which would understate
 * stock silently. Purchase history here is only posted purchases with
 * receipt_status = 'received' (bill-only purchases never moved stock,
 * so their cost must not price stock on hand).
 */
export function computeStockValuation(
  products: StockValuationProductInput[],
  purchases: StockValuationPurchaseInput[],
  method: string,
): StockValuationResult {
  if (method !== "last_purchase_cost" && method !== "average_cost") {
    return {
      method,
      status: "method_not_set",
      message:
        "Stock valuation method is not set: pass last_purchase_cost or average_cost (from the accountant-confirmed app_settings pl_config value). No valuation is returned.",
      rows: [],
      totalValue: null,
      uncostedProductIds: [],
    };
  }
  const byProduct = new Map<string, StockValuationPurchaseInput[]>();
  for (const p of purchases) {
    const list = byProduct.get(p.productId) ?? [];
    list.push(p);
    byProduct.set(p.productId, list);
  }
  const rows: StockValuationRow[] = [];
  const uncostedProductIds: string[] = [];
  let totalValue = 0;
  for (const prod of products) {
    const qty = Number(prod.closingQty) || 0;
    if (qty <= 0) continue;
    const history = (byProduct.get(prod.productId) ?? []).filter(
      (p) => (Number(p.quantity) || 0) > 0,
    );
    if (history.length === 0) {
      uncostedProductIds.push(prod.productId);
      rows.push({
        productId: prod.productId,
        closingQty: qty,
        unitCost: null,
        value: null,
      });
      continue;
    }
    let unitCost: number;
    if (method === "last_purchase_cost") {
      // Latest date wins; on a tie the last row in input order wins.
      let latest = history[0];
      for (const h of history) {
        if (String(h.date) >= String(latest.date)) latest = h;
      }
      unitCost = roundMoney(Number(latest.unitPrice) || 0);
    } else {
      let costSum = 0;
      let qtySum = 0;
      for (const h of history) {
        const q = Number(h.quantity) || 0;
        costSum = roundMoney(costSum + q * (Number(h.unitPrice) || 0));
        qtySum = roundMoney(qtySum + q);
      }
      unitCost = qtySum > 0 ? roundMoney(costSum / qtySum) : 0;
    }
    const value = roundMoney(qty * unitCost);
    totalValue = roundMoney(totalValue + value);
    rows.push({ productId: prod.productId, closingQty: qty, unitCost, value });
  }
  return {
    method,
    status: "valued",
    rows,
    totalValue,
    uncostedProductIds,
  };
}
