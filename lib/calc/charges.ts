/**
 * Service / packing charges.
 *
 * CONFIGURABLE — DO NOT HARD-CODE: the client spec marks the billing basis
 * as a client-confirmation item. The basis is therefore always a parameter
 * (`RateBasis`), and `per_50kg` is just one named basis among several —
 * the number 50 is never applied to jobs on any other basis. Likewise the
 * kg-per-maund conversion is an explicit parameter: there is NO universal
 * maund value in this codebase, and `per_maund` throws unless the caller
 * supplies the client-approved `maundKg`.
 */
import { roundMoney, assertNonNegative } from "./money";
import type { RateBasis } from "../types/database";

export type { RateBasis };

/**
 * Machinery / service charge.
 * - per_bag:  billableQty is the BAG COUNT.
 * - per_50kg: billableQty is kg, charged per 50 kg block.
 * - per_kg:   billableQty is kg.
 * - per_maund: billableQty is kg, `maundKg` (client-approved kg per maund)
 *   is REQUIRED.
 * - fixed:    charge is exactly `rate`, billableQty is ignored.
 */
export function machineryCharge(
  billableQty: number,
  basis: RateBasis,
  rate: number,
  maundKg?: number,
): number {
  assertNonNegative(billableQty, "billableQty");
  assertNonNegative(rate, "rate");
  switch (basis) {
    case "per_bag":
      return roundMoney(billableQty * rate);
    case "per_50kg":
      return roundMoney((billableQty / 50) * rate);
    case "per_kg":
      return roundMoney(billableQty * rate);
    case "per_maund": {
      if (maundKg === undefined || !Number.isFinite(maundKg) || maundKg <= 0) {
        throw new RangeError(
          "per_maund billing requires an explicit client-approved maundKg (kg per maund); no universal conversion is assumed",
        );
      }
      return roundMoney((billableQty / maundKg) * rate);
    }
    case "fixed":
      return roundMoney(rate);
    default:
      throw new RangeError(`Unknown rate basis: ${String(basis)}`);
  }
}

/**
 * Packing charge = approved bag count x configured packing rate.
 * (Or a manual approved fee — in that case the caller passes the fee as
 * `rate` with bags = 1, or bypasses this helper; the two are never mixed.)
 */
export function packingCharge(bags: number, ratePerBag: number): number {
  assertNonNegative(bags, "bags");
  assertNonNegative(ratePerBag, "ratePerBag");
  return roundMoney(bags * ratePerBag);
}

/**
 * Bardana / bag stock closing (spec §8.2):
 * closing = opening + purchased + returnsIn - consumed - damaged + adjustments
 * `adjustments` is SIGNED (+ for found stock, - for write-offs beyond damage).
 */
export function bagClosing(
  opening: number,
  purchased: number,
  returnedIn: number,
  consumed: number,
  damaged: number,
  adjustments: number,
): number {
  for (const [name, v] of [
    ["opening", opening],
    ["purchased", purchased],
    ["returnedIn", returnedIn],
    ["consumed", consumed],
    ["damaged", damaged],
  ] as const) {
    assertNonNegative(v, name);
  }
  if (!Number.isFinite(adjustments)) {
    throw new RangeError("adjustments must be a finite number");
  }
  const closing = opening + purchased + returnedIn - consumed - damaged + adjustments;
  return Math.round(closing);
}
