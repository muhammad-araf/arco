/**
 * P&L definitions and invoice allocation (spec §10.2, §11.2, §15).
 *
 * BLOCKED — lib/calc/finance does not exist yet. These tests are written
 * against the documented signatures in tests/CALC_CONTRACT.md and will
 * fail at import time until the backend adds that module. Do NOT "fix"
 * them by inlining the arithmetic here: the point is that the single
 * implementation used by server actions is itself tested.
 *
 * Definitions under test:
 * - Invoice outstanding = posted invoice total - allocated posted
 *   payments - credits/returns (spec §10.2). Payments are subtracted
 *   ONLY when explicitly allocated to that invoice: an unallocated
 *   payment must not reduce any invoice (no auto-blanket allocation,
 *   spec §10.2). A negative result is an unapplied advance (§11.2),
 *   not something to clamp silently.
 * - Receipt != revenue (spec §11.2, §15.1): collecting an invoice
 *   reduces the receivable and increases cash; it does not create
 *   revenue. Revenue comes from posted charges/invoices only.
 * - No bag double-count (spec §15.1): packaging cost is the CONSUMED
 *   bag cost. Bag purchase cost must not also be expensed, or the same
 *   bags are counted twice in P&L.
 * - Net profit = (service revenue + product sales) - (COGS + packaging
 *   cost + operating expenses + payroll) (IMPLEMENTATION_PLAN §5 Module 9).
 */
import { describe, expect, it } from "vitest";
import {
  invoiceOutstanding,
  netProfit,
  packagingCost,
} from "@/lib/calc/finance";

describe("invoiceOutstanding", () => {
  it("is total - allocated payments - credits", () => {
    expect(invoiceOutstanding(50000, 30000, 5000)).toBe(15000);
  });

  it("is zero when fully paid", () => {
    expect(invoiceOutstanding(50000, 50000, 0)).toBe(0);
  });

  it("is the full total when nothing is allocated to it", () => {
    expect(invoiceOutstanding(50000, 0, 0)).toBe(50000);
  });

  it("does NOT subtract a payment that exists but is not allocated to this invoice", () => {
    // A 20000 receipt sitting unallocated must leave this invoice at 50000.
    // Only the allocated amount (0 here) is subtracted.
    expect(invoiceOutstanding(50000, 0, 0)).toBe(50000);
  });

  it("goes negative on over-allocation (unapplied advance), not clamped to zero", () => {
    expect(invoiceOutstanding(10000, 12000, 0)).toBe(-2000);
  });

  it("subtracts credits/returns as well as payments", () => {
    expect(invoiceOutstanding(20000, 5000, 3000)).toBe(12000);
  });
});

describe("receipt is not revenue", () => {
  it("collecting an invoice in full leaves revenue unchanged and clears the receivable", () => {
    const charges = 10000;
    const receiptAllocated = 10000;
    expect(invoiceOutstanding(charges, receiptAllocated, 0)).toBe(0);
    // Revenue is built from posted charges only — the receipt is not an
    // input to netProfit at all, so it cannot inflate revenue to 20000.
    expect(
      netProfit({
        serviceRevenue: charges,
        productSalesRevenue: 0,
        cogs: 0,
        packagingCost: 0,
        operatingExpenses: 0,
        payroll: 0,
      }),
    ).toBe(10000);
  });
});

describe("packagingCost (no bag double-count)", () => {
  it("is consumed bags x cost per bag — not purchase cost", () => {
    expect(packagingCost(80, 25)).toBe(2000);
  });

  it("keeps purchase cost out of P&L packaging cost", () => {
    const consumedCost = packagingCost(80, 25); // 2000
    const purchaseCost = 500 * 25; // 12500 — must NOT be expensed as well
    expect(consumedCost).toBe(2000);
    expect(
      netProfit({
        serviceRevenue: 0,
        productSalesRevenue: 50000,
        cogs: 0,
        packagingCost: consumedCost,
        operatingExpenses: 0,
        payroll: 0,
      }),
    ).toBe(48000);
    expect(purchaseCost).not.toBe(consumedCost);
  });
});

describe("netProfit", () => {
  it("applies revenue less all recognised costs", () => {
    // (50000 + 200000) - (120000 + 5000 + 30000 + 40000) = 55000.
    expect(
      netProfit({
        serviceRevenue: 50000,
        productSalesRevenue: 200000,
        cogs: 120000,
        packagingCost: 5000,
        operatingExpenses: 30000,
        payroll: 40000,
      }),
    ).toBe(55000);
  });

  it("can be a loss (negative), not clamped to zero", () => {
    expect(
      netProfit({
        serviceRevenue: 0,
        productSalesRevenue: 10000,
        cogs: 15000,
        packagingCost: 0,
        operatingExpenses: 5000,
        payroll: 0,
      }),
    ).toBe(-10000);
  });

  it("does not treat all purchases as cost (COGS is an explicit input)", () => {
    // Purchases of 200000 with COGS of 120000: only 120000 hits P&L.
    expect(
      netProfit({
        serviceRevenue: 0,
        productSalesRevenue: 200000,
        cogs: 120000,
        packagingCost: 0,
        operatingExpenses: 0,
        payroll: 0,
      }),
    ).toBe(80000);
  });
});
