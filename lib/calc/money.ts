/**
 * Decimal-safe money / quantity arithmetic.
 *
 * Why this exists: plain JS floats give 0.1 + 0.2 = 0.30000000000000004.
 * Every money and weight figure in this ERP is rounded through here so
 * ledger rows, invoices and payroll agree to the paisa / gram instead of
 * drifting by a fraction on every row. All values are plain numbers
 * (Postgres NUMERIC on the DB side); nothing here touches the DB.
 */

/** Round to `decimals` places using integer scaling. Non-finite input -> 0. */
export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  // Small epsilon nudge so e.g. 1.005 rounds to 1.01, not 1.00.
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Money: always 2 decimals. */
export function roundMoney(value: number): number {
  return roundTo(value, 2);
}

/** Weights in this system are stored NUMERIC(12,2) / (14,2): 2 decimals. */
export function roundWeight(value: number): number {
  return roundTo(value, 2);
}

/** Decimal-safe add, rounded to `decimals` (default 2). */
export function add(a: number, b: number, decimals = 2): number {
  return roundTo(a + b, decimals);
}

/** Decimal-safe subtract, rounded to `decimals` (default 2). */
export function sub(a: number, b: number, decimals = 2): number {
  return roundTo(a - b, decimals);
}

/** Decimal-safe multiply, rounded to `decimals` (default 2). */
export function mul(a: number, b: number, decimals = 2): number {
  return roundTo(a * b, decimals);
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0 (got ${value})`);
  }
}

export { assertNonNegative };
