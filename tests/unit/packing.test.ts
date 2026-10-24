/**
 * Packing / bardana (spec §8.2, IMPLEMENTATION_PLAN Module 5).
 * Packing charge = bag count x packing rate.
 * Bag closing = opening + purchased + returns in - consumed - damaged
 *   + signed adjustments.
 */
import { describe, expect, it } from "vitest";
import { bagClosing, packingCharge } from "@/lib/calc/charges";

describe("packingCharge", () => {
  it("is bag count x packing rate", () => {
    expect(packingCharge(80, 25)).toBe(2000);
  });

  it("is zero when no bags are packed", () => {
    expect(packingCharge(0, 25)).toBe(0);
  });

  it("throws on negative bags or rate", () => {
    expect(() => packingCharge(-1, 25)).toThrow(RangeError);
    expect(() => packingCharge(80, -25)).toThrow(RangeError);
  });
});

describe("bagClosing", () => {
  it("applies opening + purchased + returns - consumed - damaged + adjustments", () => {
    // 100 + 50 + 10 - 80 - 5 + 3 = 78.
    expect(bagClosing(100, 50, 10, 80, 5, 3)).toBe(78);
  });

  it("returns opening unchanged when nothing moved", () => {
    expect(bagClosing(100, 0, 0, 0, 0, 0)).toBe(100);
  });

  it("counts returns-in as stock coming back", () => {
    expect(bagClosing(0, 0, 12, 0, 0, 0)).toBe(12);
  });

  it("accepts a negative signed adjustment (write-off beyond damage)", () => {
    expect(bagClosing(100, 0, 0, 10, 0, -5)).toBe(85);
  });

  it("throws on negative stock movements (adjustments stay signed)", () => {
    expect(() => bagClosing(100, 0, 0, -10, 0, 0)).toThrow(RangeError);
    expect(() => bagClosing(-100, 0, 0, 0, 0, 0)).toThrow(RangeError);
  });
});
