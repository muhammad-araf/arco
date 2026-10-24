/**
 * Weight calculations (inward receiving, batches, gate passes).
 * All weights are kilograms unless the parameter name says otherwise.
 */
import { roundWeight, assertNonNegative } from "./money";

/**
 * Net weight = gross weight - (bags x tare weight per bag).
 * `tarePerBagKg` is the per-bag tare for THIS line's bag type — it is a
 * caller-supplied value, never a system-wide guess.
 */
export function netWeight(
  grossKg: number,
  bags: number,
  tarePerBagKg: number,
): number {
  assertNonNegative(grossKg, "grossKg");
  assertNonNegative(bags, "bags");
  assertNonNegative(tarePerBagKg, "tarePerBagKg");
  const net = roundWeight(grossKg - bags * tarePerBagKg);
  if (net < 0) {
    throw new RangeError(
      `Net weight would be negative: gross ${grossKg} - ${bags} bags x ${tarePerBagKg} tare`,
    );
  }
  return net;
}

/** Planned component quantity = planned batch size x approved ratio %. */
export function plannedComponentQty(
  plannedSizeKg: number,
  ratioPct: number,
): number {
  assertNonNegative(plannedSizeKg, "plannedSizeKg");
  if (!Number.isFinite(ratioPct) || ratioPct < 0 || ratioPct > 100) {
    throw new RangeError(`ratioPct must be between 0 and 100 (got ${ratioPct})`);
  }
  return roundWeight((plannedSizeKg * ratioPct) / 100);
}

/**
 * Actual yield % = actual usable output / total actual input x 100.
 * This is the spec's definition (usable output only — by-product/waste are
 * NOT counted as output; whether by-product is saleable stock is a separate
 * configured decision recorded on the batch, not assumed here).
 * Returns 0 when input is 0 instead of NaN/Infinity.
 */
export function yieldPct(outputKg: number, inputKg: number): number {
  assertNonNegative(outputKg, "outputKg");
  assertNonNegative(inputKg, "inputKg");
  if (inputKg === 0) return 0;
  return roundWeight((outputKg / inputKg) * 100);
}

/** Variance of actual vs plan, in both quantity and percent. */
export function variance(
  actual: number,
  planned: number,
): { qty: number; pct: number } {
  if (!Number.isFinite(actual) || !Number.isFinite(planned)) {
    throw new RangeError("variance inputs must be finite numbers");
  }
  const qty = roundWeight(actual - planned);
  // No plan to vary against: quantity variance is still meaningful, % is not.
  const pct = planned === 0 ? 0 : roundWeight((qty / planned) * 100);
  return { qty, pct };
}
