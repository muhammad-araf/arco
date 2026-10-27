/**
 * Production-gap program (spec §6, §7, §8): multi-line job totals,
 * yield over multiple finished outputs, and the variance-tolerance
 * gate. The tolerance itself is never hard-coded: null means the
 * app setting is absent and the gate is disabled.
 */
import { describe, expect, it } from "vitest";
import { yieldPct } from "@/lib/calc/weights";
import { machineryCharge, packingCharge } from "@/lib/calc/charges";
import {
  parseVarianceTolerance,
  sumFinishedOutputs,
  sumJobLines,
  varianceExceedsTolerance,
} from "@/app/actions/production-helpers";

describe("sumJobLines (multi-line machinery jobs)", () => {
  it("sums input, output and by-product across lines", () => {
    expect(
      sumJobLines([
        { inputProductId: "a", inputQtyKg: 5000, outputProductId: "x", outputQtyKg: 4600, byproductProductId: "b", byproductQtyKg: 200 },
        { inputProductId: "c", inputQtyKg: 3000, outputProductId: "y", outputQtyKg: 2700, byproductProductId: null, byproductQtyKg: 0 },
      ]),
    ).toEqual({ totalInputKg: 8000, totalOutputKg: 7300, totalByproductKg: 200 });
  });

  it("one line equals the legacy single-line job totals", () => {
    expect(
      sumJobLines([
        { inputProductId: "a", inputQtyKg: 5000, outputProductId: "x", outputQtyKg: 4600 },
      ]),
    ).toEqual({ totalInputKg: 5000, totalOutputKg: 4600, totalByproductKg: 0 });
  });

  it("treats missing quantities as zero", () => {
    expect(
      sumJobLines([{ inputProductId: "a", inputQtyKg: 100 }]),
    ).toEqual({ totalInputKg: 100, totalOutputKg: 0, totalByproductKg: 0 });
  });
});

describe("job-level charge over total input", () => {
  it("bills per_kg on the summed input, not per line", () => {
    const totals = sumJobLines([
      { inputProductId: "a", inputQtyKg: 5000 },
      { inputProductId: "c", inputQtyKg: 3000 },
    ]);
    expect(machineryCharge(totals.totalInputKg, "per_kg", 2)).toBe(16000);
  });

  it("per_bag still bills the job bag count, never weight / 50", () => {
    expect(machineryCharge(120, "per_bag", 50)).toBe(6000);
  });
});

describe("yield over multiple finished outputs", () => {
  it("sums every finished output row", () => {
    const finishedKg = sumFinishedOutputs([
      { output_type: "finished", qty_kg: 60 },
      { output_type: "finished", qty_kg: 30 },
      { output_type: "byproduct", qty_kg: 8 },
    ]);
    expect(finishedKg).toBe(90);
    expect(yieldPct(finishedKg, 100)).toBe(90);
  });

  it("does not count by-product as yield even when it is the only row", () => {
    expect(sumFinishedOutputs([{ output_type: "byproduct", qty_kg: 8 }])).toBe(0);
  });

  it("a single finished row behaves as before", () => {
    expect(yieldPct(sumFinishedOutputs([{ output_type: "finished", qty_kg: 92 }]), 100)).toBe(92);
  });
});

describe("variance tolerance gate", () => {
  it("null tolerance disables the gate entirely", () => {
    expect(varianceExceedsTolerance([{ pct: 99 }], null)).toBe(false);
  });

  it("flags an input whose |variance %| exceeds the tolerance", () => {
    expect(varianceExceedsTolerance([{ pct: 5 }, { pct: 12 }], 10)).toBe(true);
    expect(varianceExceedsTolerance([{ pct: -12 }], 10)).toBe(true);
  });

  it("does not flag variances at or below the tolerance", () => {
    expect(varianceExceedsTolerance([{ pct: 10 }, { pct: -10 }], 10)).toBe(false);
    expect(varianceExceedsTolerance([{ pct: 3 }], 10)).toBe(false);
  });
});

describe("parseVarianceTolerance (settings value shapes)", () => {
  it("accepts a bare number", () => {
    expect(parseVarianceTolerance(10)).toBe(10);
  });

  it("accepts an object carrying the key", () => {
    expect(parseVarianceTolerance({ variance_tolerance_pct: 7.5 })).toBe(7.5);
    expect(parseVarianceTolerance({ value: 5 })).toBe(5);
  });

  it("returns null for absent, negative or unparseable values — never a guess", () => {
    expect(parseVarianceTolerance(null)).toBe(null);
    expect(parseVarianceTolerance(undefined)).toBe(null);
    expect(parseVarianceTolerance(-3)).toBe(null);
    expect(parseVarianceTolerance("not a number")).toBe(null);
    expect(parseVarianceTolerance({})).toBe(null);
  });
});

describe("packing line charges", () => {
  it("sums bags x rate across lines", () => {
    const lines = [
      { bags: 100, rate: 15 },
      { bags: 50, rate: 15 },
    ];
    expect(lines.reduce((s, l) => s + packingCharge(l.bags, l.rate), 0)).toBe(2250);
  });
});
