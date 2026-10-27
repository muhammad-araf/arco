/**
 * Ledger arithmetic — the single-ledger rule lives here.
 * Balances are ALWAYS derived from ledger rows, never stored as an
 * independently editable total. These helpers only do the arithmetic;
 * server actions are responsible for reading/writing the rows.
 */
import { roundMoney, roundWeight } from "./money";

/** Running balance after one ledger row: prev + inward - outward. */
export function ledgerRunningBalance(
  prevBalance: number,
  inwardQty: number,
  outwardQty: number,
): number {
  if (![prevBalance, inwardQty, outwardQty].every(Number.isFinite)) {
    throw new RangeError("ledgerRunningBalance inputs must be finite numbers");
  }
  return roundWeight(prevBalance + inwardQty - outwardQty);
}

/** Sum a set of stock_ledger rows into a balance (inward - outward). */
export function stockBalanceFromRows(
  rows: ReadonlyArray<{ inward_qty: number; outward_qty: number }>,
): number {
  let balance = 0;
  for (const row of rows) balance += row.inward_qty - row.outward_qty;
  return roundWeight(balance);
}

/** One (product, owner) pool quantity. partyId null = company-owned pool. */
export interface PoolQuantity {
  productId: string;
  partyId: string | null;
  qtyKg: number;
}

function poolKey(productId: string, partyId: string | null): string {
  return `${productId}|${partyId ?? ""}`;
}

/**
 * Aggregate quantities per (product, owner) pool. Guards MUST run on the
 * aggregated totals, never per line: two lines for the same pool each
 * passing a per-line check can jointly drive the pool negative (the
 * inward-reversal bypass this was added for).
 */
export function aggregatePoolQuantities(
  lines: ReadonlyArray<PoolQuantity>,
): PoolQuantity[] {
  const byKey = new Map<string, PoolQuantity>();
  for (const line of lines) {
    const key = poolKey(line.productId, line.partyId);
    const entry = byKey.get(key) ?? { productId: line.productId, partyId: line.partyId, qtyKg: 0 };
    entry.qtyKg = roundWeight(entry.qtyKg + line.qtyKg);
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/** Distinct owner pool ids a product was dispatched from (null = company). */
export function ownersForProduct(
  dispatched: ReadonlyArray<PoolQuantity>,
  productId: string,
): (string | null)[] {
  const seen = new Set<string>();
  const owners: (string | null)[] = [];
  for (const line of dispatched) {
    if (line.productId !== productId) continue;
    const key = line.partyId ?? "";
    if (!seen.has(key)) {
      seen.add(key);
      owners.push(line.partyId);
    }
  }
  return owners;
}

/**
 * Validate a new gate-pass return against dispatched quantities and prior
 * returns, cumulatively per (product, owner) pool. Returns the aggregated
 * new-return list, or an error string naming the offending pool.
 */
export function validateCumulativeReturns(
  dispatched: ReadonlyArray<PoolQuantity>,
  priorReturns: ReadonlyArray<PoolQuantity>,
  requested: ReadonlyArray<PoolQuantity>,
): { ok: true; aggregated: PoolQuantity[] } | { ok: false; error: string } {
  const sent = new Map(aggregatePoolQuantities(dispatched).map((p) => [poolKey(p.productId, p.partyId), p.qtyKg]));
  const prior = new Map(aggregatePoolQuantities(priorReturns).map((p) => [poolKey(p.productId, p.partyId), p.qtyKg]));
  const aggregated = aggregatePoolQuantities(requested);
  for (const ret of aggregated) {
    if (!(ret.qtyKg > 0)) {
      return { ok: false, error: `Return quantity for product ${ret.productId} must be greater than 0` };
    }
    const dispatchedQty = sent.get(poolKey(ret.productId, ret.partyId));
    if (dispatchedQty === undefined) {
      return { ok: false, error: `Product ${ret.productId} was not dispatched from this owner pool on this pass` };
    }
    const already = prior.get(poolKey(ret.productId, ret.partyId)) ?? 0;
    if (roundWeight(already + ret.qtyKg) > dispatchedQty) {
      return {
        ok: false,
        error: `Return for product ${ret.productId} exceeds what is left to return: dispatched ${dispatchedQty} kg, already returned ${already} kg, this return ${ret.qtyKg} kg`,
      };
    }
  }
  return { ok: true, aggregated };
}

/** Quantity still returnable per pool: dispatched minus prior returns. */
export function remainingReturnable(
  dispatched: ReadonlyArray<PoolQuantity>,
  priorReturns: ReadonlyArray<PoolQuantity>,
): PoolQuantity[] {
  const sent = aggregatePoolQuantities(dispatched);
  const prior = new Map(aggregatePoolQuantities(priorReturns).map((p) => [poolKey(p.productId, p.partyId), p.qtyKg]));
  return sent
    .map((p) => ({ ...p, qtyKg: roundWeight(p.qtyKg - (prior.get(poolKey(p.productId, p.partyId)) ?? 0)) }))
    .filter((p) => p.qtyKg > 0);
}

/** Pass status after a return: fully returned only when nothing remains. */
export function gatePassStatusAfterReturn(
  dispatchedTotalKg: number,
  returnedTotalKg: number,
): "partially_returned" | "returned" {
  return roundWeight(returnedTotalKg) >= roundWeight(dispatchedTotalKg)
    ? "returned"
    : "partially_returned";
}

/** One return line carrying its restock decision (spec §9 return). */
export interface ReturnRestockLine extends PoolQuantity {
  /** 'accepted' restocks, 'rejected' never returns to stock. Null /
   *  undefined means accepted: rows written before the decision
   *  column existed always restocked, and that behaviour is kept. */
  restockDecision?: "accepted" | "rejected" | null;
}

/**
 * Quantities that actually return to stock from a return: ONLY the
 * accepted lines, aggregated per (product, owner) pool. A rejected
 * line is recorded on gate_pass_returns but contributes nothing here,
 * so the ledger never credits rejected quantity.
 */
export function acceptedRestockQuantities(
  lines: ReadonlyArray<ReturnRestockLine>,
): PoolQuantity[] {
  return aggregatePoolQuantities(
    lines
      .filter((l) => l.restockDecision !== "rejected")
      .map((l) => ({ productId: l.productId, partyId: l.partyId, qtyKg: l.qtyKg })),
  );
}

/**
 * Daybook closing (spec §7): closing = opening + receipts - payments.
 * Receipts/payments are totals for the day (or period) being closed.
 */
export function daybookClosing(
  openingBalance: number,
  receipts: number,
  payments: number,
): number {
  if (![openingBalance, receipts, payments].every(Number.isFinite)) {
    throw new RangeError("daybookClosing inputs must be finite numbers");
  }
  return roundMoney(openingBalance + receipts - payments);
}

/** Cash running balance after one cash_ledger row: prev + debit - credit. */
export function cashRunningBalance(
  prevBalance: number,
  debit: number,
  credit: number,
): number {
  if (![prevBalance, debit, credit].every(Number.isFinite)) {
    throw new RangeError("cashRunningBalance inputs must be finite numbers");
  }
  return roundMoney(prevBalance + debit - credit);
}
