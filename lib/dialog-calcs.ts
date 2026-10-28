/**
 * Pure per-line computed values shown inside dialogs. These only
 * format numbers the form already has — they never change a posting,
 * a guard, or a stored value.
 */

/** A line's share of a total, as a whole percent (0 when total is 0). */
export function lineSharePct(qtyKg: number, totalKg: number): number {
  if (!(totalKg > 0)) return 0
  return Math.round(((Number(qtyKg) || 0) / totalKg) * 100)
}

/** A line's yield: output as a whole percent of its input (0 when input is 0). */
export function lineYieldPct(outputKg: number, inputKg: number): number {
  if (!(inputKg > 0)) return 0
  return Math.round(((Number(outputKg) || 0) / inputKg) * 100)
}

/** Input not accounted for by output + by-product on one line.
 *  Job-level waste is separate and never folded into this figure. */
export function lineUnaccountedKg(inputKg: number, outputKg: number, byproductKg: number): number {
  return (Number(inputKg) || 0) - (Number(outputKg) || 0) - (Number(byproductKg) || 0)
}

/** One packing line's charge: bags x the packing rate. */
export function packingLineCharge(bags: number, ratePerBag: number): number {
  return (Number(bags) || 0) * (Number(ratePerBag) || 0)
}

/** Packed kg per bag on one packing line (0 when no bags). */
export function kgPerBag(packedKg: number, bags: number): number {
  if (!(bags > 0)) return 0
  return (Number(packedKg) || 0) / bags
}
