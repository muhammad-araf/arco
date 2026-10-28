/**
 * Per-line computed values rendered inside the production, machinery
 * and packing dialogs. Presentation-only helpers: no posting, guard
 * or stored value depends on them.
 */
import { describe, expect, it } from "vitest";
import {
  kgPerBag,
  lineSharePct,
  lineUnaccountedKg,
  lineYieldPct,
  packingLineCharge,
} from "@/lib/dialog-calcs";

describe("lineSharePct", () => {
  it("is the line qty as a whole percent of the total", () => {
    expect(lineSharePct(2500, 10000)).toBe(25);
  });

  it("is 0 when the total is 0", () => {
    expect(lineSharePct(100, 0)).toBe(0);
  });
});

describe("lineYieldPct", () => {
  it("is output as a percent of input", () => {
    expect(lineYieldPct(4600, 5000)).toBe(92);
  });

  it("is 0 when input is 0", () => {
    expect(lineYieldPct(100, 0)).toBe(0);
  });
});

describe("lineUnaccountedKg", () => {
  it("is input minus output minus by-product", () => {
    expect(lineUnaccountedKg(5000, 4600, 250)).toBe(150);
  });
});

describe("packingLineCharge", () => {
  it("is bags x rate", () => {
    expect(packingLineCharge(80, 15)).toBe(1200);
  });

  it("is 0 when no bags are packed", () => {
    expect(packingLineCharge(0, 15)).toBe(0);
  });
});

describe("kgPerBag", () => {
  it("divides packed kg by bags", () => {
    expect(kgPerBag(4000, 80)).toBe(50);
  });

  it("is 0 when no bags are packed", () => {
    expect(kgPerBag(4000, 0)).toBe(0);
  });
});
