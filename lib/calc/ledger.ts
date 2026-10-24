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
