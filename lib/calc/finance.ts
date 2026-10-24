/**
 * Finance definitions (spec §10.2, §11.2, §15.1).
 *
 * Pure functions only, like the rest of lib/calc: no DB access, no
 * side effects. All results are rounded to 2 decimals via roundMoney.
 *
 * Two deliberate non-clamps — do not "fix" them:
 * - invoiceOutstanding may go NEGATIVE: that is an unapplied advance
 *   (spec §11.2), not an error to clamp to zero.
 * - netProfit may go negative: that is a loss, not zero.
 *
 * And two deliberate absences:
 * - Receipts are NOT an input to netProfit: a receipt is cash
 *   collection, not revenue (spec §15.1). Revenue comes from posted
 *   charges/invoices only.
 * - Purchases are NOT an input to netProfit: only approved COGS hits
 *   P&L (spec §15.1), so `cogs` is an explicit input.
 */
import { roundMoney } from "./money";

/**
 * Invoice outstanding = total − payments explicitly allocated to this
 * invoice − credits/returns (spec §10.2). Only allocated payments are
 * subtracted: an unallocated receipt sitting elsewhere must not reduce
 * this invoice (no auto-blanket allocation).
 */
export function invoiceOutstanding(
  invoiceTotal: number,
  allocatedPayments: number,
  credits: number,
): number {
  return roundMoney(invoiceTotal - allocatedPayments - credits);
}

export interface NetProfitInput {
  serviceRevenue: number;
  productSalesRevenue: number;
  cogs: number;
  packagingCost: number;
  operatingExpenses: number;
  payroll: number;
}

/**
 * Net profit = (service revenue + product sales) − (COGS + packaging
 * cost + operating expenses + payroll).
 */
export function netProfit(input: NetProfitInput): number {
  const revenue = input.serviceRevenue + input.productSalesRevenue;
  const costs =
    input.cogs +
    input.packagingCost +
    input.operatingExpenses +
    input.payroll;
  return roundMoney(revenue - costs);
}

/**
 * Packaging cost = consumed bags × cost per bag (spec §15.1). Bag
 * purchase cost must NOT be added again — that would count the same
 * bags twice in P&L (no bag double-count).
 */
export function packagingCost(consumedBags: number, costPerBag: number): number {
  return roundMoney(consumedBags * costPerBag);
}
