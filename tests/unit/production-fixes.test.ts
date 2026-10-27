/**
 * Production-chain fixes (QA audit 2026-10-27): mass-balance validation,
 * aggregated stock guards, and charge math from STORED bag/maund inputs
 * — never weight / 50, never a hardcoded maund value.
 */
import { describe, expect, it } from "vitest";
import { validateMassBalance, aggregateQuantities } from "@/lib/calc/weights";
import { machineryCharge } from "@/lib/calc/charges";

describe("validateMassBalance (server trust boundary)", () => {
  it("accepts a balanced batch", () => {
    expect(validateMassBalance({ inputKg: 10000, outputKg: 9200, byproductKg: 550, wasteKg: 250 })).toBeNull();
  });

  it("rejects output + by-product + waste over input", () => {
    expect(validateMassBalance({ inputKg: 100, outputKg: 90, byproductKg: 20, wasteKg: 0 })).toMatch(/exceeds input/);
  });

  it("rejects negative by-product and negative waste", () => {
    expect(validateMassBalance({ inputKg: 100, outputKg: 90, byproductKg: -5 })).toMatch(/negative/);
    expect(validateMassBalance({ inputKg: 100, outputKg: 90, wasteKg: -1 })).toMatch(/negative/);
  });

  it("rejects zero input with output over zero, accepts zero/zero", () => {
    expect(validateMassBalance({ inputKg: 0, outputKg: 10 })).toMatch(/zero/);
    expect(validateMassBalance({ inputKg: 0, outputKg: 0 })).toBeNull();
  });
});

describe("aggregateQuantities (duplicate lines, B7 class)", () => {
  it("sums duplicate lines per (product, party) so guards see the total", () => {
    const out = aggregateQuantities([
      { productId: "p1", partyId: null, qtyKg: 60 },
      { productId: "p1", partyId: null, qtyKg: 60 },
      { productId: "p1", partyId: "party-a", qtyKg: 60 },
    ]);
    expect(out).toEqual([
      { productId: "p1", partyId: null, qtyKg: 120 },
      { productId: "p1", partyId: "party-a", qtyKg: 60 },
    ]);
  });
});

describe("machineryCharge from stored inputs", () => {
  it("per_bag bills the stored actual bag count, not weight / 50", () => {
    // 37 actual bags at 50 PKR: 1850, even though the weight (5000 kg)
    // divided by 50 would give 100 bags.
    expect(machineryCharge(37, "per_bag", 50)).toBe(1850);
  });

  it("per_maund bills with the stored client-approved maundKg", () => {
    // 5000 kg at a stored 37.5 kg/maund = 133.33 maund x 90 = 12000.
    expect(machineryCharge(5000, "per_maund", 90, 37.5)).toBe(12000);
  });
});
