/**
 * Production batches — planned requirements, yield %, variance (spec §6.4).
 * Yield uses usable output ONLY (by-product/waste are not output).
 * Variance = actual consumption - planned consumption, in qty and %.
 */
import { describe, expect, it } from "vitest";
import { plannedComponentQty, variance, yieldPct } from "@/lib/calc/weights";

describe("plannedComponentQty (spec §6.3 example: 70/30 of 100 kg)", () => {
  it("computes the spec example: 70% of 100 kg is 70 kg", () => {
    expect(plannedComponentQty(100, 70)).toBe(70);
    expect(plannedComponentQty(100, 30)).toBe(30);
  });

  it("handles 0% and 100% ratios", () => {
    expect(plannedComponentQty(250, 0)).toBe(0);
    expect(plannedComponentQty(250, 100)).toBe(250);
  });

  it("throws on a ratio outside 0-100", () => {
    expect(() => plannedComponentQty(100, 101)).toThrow(RangeError);
    expect(() => plannedComponentQty(100, -5)).toThrow(RangeError);
  });
});

describe("yieldPct", () => {
  it("computes usable output / total input x 100", () => {
    expect(yieldPct(92, 100)).toBe(92);
    expect(yieldPct(33, 40)).toBe(82.5);
  });

  it("returns 0 for zero output and for zero input (no NaN/Infinity)", () => {
    expect(yieldPct(0, 100)).toBe(0);
    expect(yieldPct(50, 0)).toBe(0);
  });

  it("does not count by-product/waste as output (caller passes usable only)", () => {
    // 90 kg usable + 8 kg by-product from 100 kg input: yield is 90, not 98.
    expect(yieldPct(90, 100)).toBe(90);
  });
});

describe("variance", () => {
  it("reports over-consumption in qty and percent", () => {
    expect(variance(75, 70)).toEqual({ qty: 5, pct: 7.14 });
  });

  it("reports under-consumption as negative qty and percent", () => {
    expect(variance(65, 70)).toEqual({ qty: -5, pct: -7.14 });
  });

  it("is zero when actual equals plan", () => {
    expect(variance(70, 70)).toEqual({ qty: 0, pct: 0 });
  });

  it("still reports qty variance when there was no plan (pct is 0, not NaN)", () => {
    expect(variance(10, 0)).toEqual({ qty: 10, pct: 0 });
  });
});
