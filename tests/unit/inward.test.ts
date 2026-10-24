/**
 * Inward receiving — net weight (spec §4, IMPLEMENTATION_PLAN §5 Module 2).
 * Formula: net weight = gross weight - (bags x tare weight per bag).
 * Tare is per-bag for THIS line's bag type, supplied by the caller.
 */
import { describe, expect, it } from "vitest";
import { netWeight } from "@/lib/calc/weights";

describe("netWeight", () => {
  it("subtracts bags x tare from gross weight", () => {
    expect(netWeight(1000, 20, 0.5)).toBe(990);
  });

  it("returns gross weight when there are zero bags", () => {
    expect(netWeight(500, 0, 0.5)).toBe(500);
  });

  it("returns gross weight when tare is zero", () => {
    expect(netWeight(500, 20, 0)).toBe(500);
  });

  it("handles fractional tare and weight to 2 decimals", () => {
    expect(netWeight(100.5, 3, 0.25)).toBe(99.75);
  });

  it("throws instead of returning a negative net weight", () => {
    // Tare exceeding gross is a data error, not a negative receipt.
    expect(() => netWeight(10, 20, 1)).toThrow(RangeError);
  });

  it("throws on negative inputs", () => {
    expect(() => netWeight(-100, 20, 0.5)).toThrow(RangeError);
    expect(() => netWeight(100, -1, 0.5)).toThrow(RangeError);
    expect(() => netWeight(100, 20, -0.5)).toThrow(RangeError);
  });
});
