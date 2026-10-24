/**
 * Machinery / service charges (spec §7.2, IMPLEMENTATION_PLAN Module 4).
 * Charge = (billable quantity / billing basis) x rate. The basis is always
 * a parameter; 50 appears ONLY inside the explicitly-named per_50kg basis.
 * per_maund requires an explicit client-approved kg-per-maund factor —
 * there is no universal maund value (spec §3.1, §19).
 */
import { describe, expect, it } from "vitest";
import { machineryCharge } from "@/lib/calc/charges";

describe("machineryCharge", () => {
  it("per_bag: bag count x rate, weight ignored", () => {
    expect(machineryCharge(20, "per_bag", 50)).toBe(1000);
    expect(machineryCharge(0, "per_bag", 50)).toBe(0);
  });

  it("per_50kg: kg / 50 x rate", () => {
    expect(machineryCharge(125, "per_50kg", 100)).toBe(250);
    expect(machineryCharge(50, "per_50kg", 100)).toBe(100);
  });

  it("per_kg: kg x rate", () => {
    expect(machineryCharge(125.5, "per_kg", 2)).toBe(251);
  });

  it("per_maund: kg / client-approved maundKg x rate", () => {
    // 100 kg at 40 kg/maund = 2.5 maund x 500 = 1250.
    expect(machineryCharge(100, "per_maund", 500, 40)).toBe(1250);
  });

  it("per_maund: throws without an explicit maundKg (no assumed conversion)", () => {
    expect(() => machineryCharge(100, "per_maund", 500)).toThrow(RangeError);
    expect(() => machineryCharge(100, "per_maund", 500, 0)).toThrow(RangeError);
  });

  it("fixed: charge is exactly the rate, billable quantity ignored", () => {
    expect(machineryCharge(1000, "fixed", 7500)).toBe(7500);
    expect(machineryCharge(0, "fixed", 7500)).toBe(7500);
  });

  it("throws on negative quantity or rate", () => {
    expect(() => machineryCharge(-5, "per_kg", 2)).toThrow(RangeError);
    expect(() => machineryCharge(5, "per_kg", -2)).toThrow(RangeError);
  });

  it("throws on an unknown rate basis", () => {
    expect(() =>
      machineryCharge(5, "per_ton" as never, 2),
    ).toThrow(RangeError);
  });
});
