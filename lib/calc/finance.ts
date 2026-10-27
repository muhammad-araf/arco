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

/**
 * Exclusive end bound for a date-range `to` value (B5 fix). Date
 * columns are TIMESTAMPTZ, so `.lte("date", "2026-10-27")` means
 * midnight at the START of the 27th and silently drops the whole day.
 * A plain YYYY-MM-DD `to` becomes the next calendar day and callers
 * use `.lt("date", bound)`; a full timestamp is returned unchanged so
 * callers that already pass one keep their exact bound.
 */
export function exclusiveToBound(to: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const d = new Date(`${to}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return to;
    return new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
  }
  return to;
}

/**
 * Aggregate duplicate allocation targets in one payment (vendor
 * payment guard): two lines to the same (targetType, targetId) sum
 * into one, so the balance check and the payment_allocations unique
 * key (payment_id, target_type, target_id) both see the true total.
 * Order of first appearance is kept.
 */
export function aggregateAllocations<T extends { targetType: string; targetId: string; amount: number }>(
  allocations: T[],
): { targetType: string; targetId: string; amount: number }[] {
  const merged = new Map<string, { targetType: string; targetId: string; amount: number }>();
  for (const a of allocations) {
    const key = `${a.targetType}:${a.targetId}`;
    const cur = merged.get(key);
    if (cur) cur.amount = roundMoney(cur.amount + a.amount);
    else merged.set(key, { targetType: a.targetType, targetId: a.targetId, amount: roundMoney(a.amount) });
  }
  return [...merged.values()];
}

/**
 * Customer balance net of unapplied advances (billing fix): opening
 * + posted invoice balances − unapplied receipt amounts. Invoice
 * balances already subtract ALLOCATED receipts, so only the unapplied
 * remainder is subtracted again; ignoring it overstates receivables
 * and misfires the over-collection guard.
 */
export function customerBalanceNetOfAdvances(
  signedOpening: number,
  invoiceBalances: number[],
  unappliedAdvances: number[],
): number {
  let bal = roundMoney(signedOpening);
  for (const b of invoiceBalances) bal = roundMoney(bal + b);
  for (const u of unappliedAdvances) bal = roundMoney(bal - u);
  return bal;
}

/**
 * Signed opening for a party: receivable-positive, payable-negative.
 * An opening_balances evidence amount is a magnitude unless it is
 * already negative, in which case its own sign wins.
 */
export function signedPartyOpening(
  amount: number,
  balanceType: "receivable" | "payable" | string | null | undefined,
): number {
  const n = roundMoney(Number(amount) || 0);
  if (n < 0) return n;
  return balanceType === "payable" ? -n : n;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsUnderThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

function wordsWhole(n: number): string {
  if (n === 0) return "Zero";
  if (n < 1000) return wordsUnderThousand(n);
  // South-Asian grouping after thousands: lakh (10^5) and crore (10^7),
  // matching how PKR amounts are spoken. Falls back to plain thousands
  // grouping for the remainder below one lakh.
  const scales: [number, string][] = [
    [10000000, "Crore"],
    [100000, "Lakh"],
    [1000, "Thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [value, label] of scales) {
    if (rest >= value) {
      const count = Math.floor(rest / value);
      parts.push(`${count < 1000 ? wordsUnderThousand(count) : wordsWhole(count)} ${label}`);
      rest %= value;
    }
  }
  if (rest > 0) parts.push(wordsUnderThousand(rest));
  return parts.join(" ");
}

/**
 * Amount in words for a receipt voucher (PKR): "Rupees ... and Paise
 * .. only". Whole rupees only → no paise clause. Negative amounts
 * are rendered with a leading "Minus".
 */
export function amountInWordsPKR(amount: number): string {
  const rounded = roundMoney(Number(amount) || 0);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);
  let out = `${wordsWhole(rupees)} Rupee${rupees === 1 ? "" : "s"}`;
  if (paise > 0) out += ` and ${wordsWhole(paise)} Paise`;
  out += " only";
  return negative ? `Minus ${out}` : out;
}
