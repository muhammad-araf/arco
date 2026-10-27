/**
 * Finance valuation pure-function tests (spec §15):
 * - bardana valuation sums only recorded total_cost values;
 * - P&L packaging cost uses an allow-list of genuine consumption
 *   voucher types (purchases/returns/reversals excluded);
 * - stock valuation follows the method argument, and "unconfirmed"
 *   returns no number at all.
 */
import { describe, expect, it } from "vitest";
import {
  BARDANA_VALUATION_LABEL,
  PACKAGING_CONSUMPTION_VOUCHER_TYPES,
  bardanaValuation,
  computeStockValuation,
  isPackagingConsumptionVoucherType,
} from "@/lib/calc/finance-valuation";

describe("bardanaValuation (sums recorded costs only)", () => {
  it("sums in-cost and out-cost separately and nets them", () => {
    expect(
      bardanaValuation([
        { in_qty: 100, out_qty: 0, total_cost: 2500 },
        { in_qty: 0, out_qty: 40, total_cost: 800 },
        { in_qty: 0, out_qty: 10, total_cost: null },
      ]),
    ).toEqual({
      inCost: 2500,
      outCost: 800,
      netRecordedCost: 1700,
      label: BARDANA_VALUATION_LABEL,
    });
  });

  it("treats uncosted rows as 0, not as free stock", () => {
    const v = bardanaValuation([{ in_qty: 50, out_qty: 0, total_cost: null }]);
    expect(v.inCost).toBe(0);
    expect(v.netRecordedCost).toBe(0);
  });

  it("labels the sum as recorded costs, never a costing method", () => {
    expect(BARDANA_VALUATION_LABEL).toMatch(/not a costing-method valuation/i);
  });
});

describe("packaging consumption allow-list (P&L §15.1)", () => {
  it("admits only packing and batch_packing", () => {
    expect([...PACKAGING_CONSUMPTION_VOUCHER_TYPES].sort()).toEqual([
      "batch_packing",
      "packing",
    ]);
    expect(isPackagingConsumptionVoucherType("packing")).toBe(true);
    expect(isPackagingConsumptionVoucherType("batch_packing")).toBe(true);
  });

  it("excludes purchases, returns and reversals", () => {
    for (const vt of [
      "purchase",
      "purchase_return",
      "purchase_reversal",
      "packing_reversal",
      "batch_packing_reversal",
      "transfer",
      "unknown_future_type",
      undefined,
      null,
    ]) {
      expect(isPackagingConsumptionVoucherType(vt)).toBe(false);
    }
  });
});

describe("computeStockValuation", () => {
  const products = [{ productId: "p1", closingQty: 100 }];
  const purchases = [
    { productId: "p1", quantity: 200, unitPrice: 100, date: "2026-10-01" },
    { productId: "p1", quantity: 100, unitPrice: 130, date: "2026-10-20" },
  ];

  it("last_purchase_cost uses the latest purchase price", () => {
    const r = computeStockValuation(products, purchases, "last_purchase_cost");
    expect(r.status).toBe("valued");
    if (r.status === "valued") {
      expect(r.rows).toEqual([
        { productId: "p1", closingQty: 100, unitCost: 130, value: 13000 },
      ]);
      expect(r.totalValue).toBe(13000);
    }
  });

  it("average_cost uses the quantity-weighted average price", () => {
    // (200×100 + 100×130) / 300 = 110; 100 × 110 = 11000.
    const r = computeStockValuation(products, purchases, "average_cost");
    expect(r.status).toBe("valued");
    if (r.status === "valued") {
      expect(r.rows[0].unitCost).toBe(110);
      expect(r.totalValue).toBe(11000);
    }
  });

  it("unconfirmed returns method_not_set and never a number", () => {
    const r = computeStockValuation(products, purchases, "unconfirmed");
    expect(r.status).toBe("method_not_set");
    expect(r.totalValue).toBeNull();
    expect(r.rows).toEqual([]);
    if (r.status === "method_not_set") {
      expect(r.message).toMatch(/not set/i);
    }
  });

  it("an unknown method also returns method_not_set", () => {
    const r = computeStockValuation(products, purchases, "fifo");
    expect(r.status).toBe("method_not_set");
    expect(r.totalValue).toBeNull();
  });

  it("stock with no purchase history is listed uncosted, never valued at 0", () => {
    const r = computeStockValuation(
      [{ productId: "p9", closingQty: 50 }],
      purchases,
      "average_cost",
    );
    expect(r.status).toBe("valued");
    if (r.status === "valued") {
      expect(r.rows[0].value).toBeNull();
      expect(r.uncostedProductIds).toEqual(["p9"]);
      expect(r.totalValue).toBe(0);
    }
  });

  it("zero/negative closing stock is not valued", () => {
    const r = computeStockValuation(
      [{ productId: "p1", closingQty: 0 }],
      purchases,
      "last_purchase_cost",
    );
    if (r.status === "valued") expect(r.rows).toEqual([]);
  });
});
