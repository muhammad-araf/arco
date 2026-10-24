/**
 * Unit conversions. The client spec is explicit: "Do not assume a universal
 * conversion" between kg, bag and maund. Every conversion therefore takes
 * its factor as an argument — the bag weight comes from the product /
 * packaging master, the kg-per-maund comes from a client-approved setting.
 * There are no default factors anywhere in this file.
 */
import { roundWeight, assertNonNegative } from "./money";

/** kg -> maund using the caller-supplied, client-approved kg per maund. */
export function kgToMaund(kg: number, maundKg: number): number {
  assertNonNegative(kg, "kg");
  if (!Number.isFinite(maundKg) || maundKg <= 0) {
    throw new RangeError("maundKg must be a client-approved value > 0");
  }
  return roundWeight(kg / maundKg);
}

/** Maund -> kg using the caller-supplied, client-approved kg per maund. */
export function maundToKg(maund: number, maundKg: number): number {
  assertNonNegative(maund, "maund");
  if (!Number.isFinite(maundKg) || maundKg <= 0) {
    throw new RangeError("maundKg must be a client-approved value > 0");
  }
  return roundWeight(maund * maundKg);
}

/** Bags -> kg using this product/bag type's weight per bag. */
export function bagsToKg(bags: number, weightPerBagKg: number): number {
  assertNonNegative(bags, "bags");
  if (!Number.isFinite(weightPerBagKg) || weightPerBagKg <= 0) {
    throw new RangeError("weightPerBagKg must be > 0");
  }
  return roundWeight(bags * weightPerBagKg);
}

/** kg -> bags using this product/bag type's weight per bag. */
export function kgToBags(kg: number, weightPerBagKg: number): number {
  assertNonNegative(kg, "kg");
  if (!Number.isFinite(weightPerBagKg) || weightPerBagKg <= 0) {
    throw new RangeError("weightPerBagKg must be > 0");
  }
  return roundWeight(kg / weightPerBagKg);
}
