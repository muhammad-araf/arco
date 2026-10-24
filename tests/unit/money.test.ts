/**
 * Decimal-safe money/weight rounding (spec §1.2: decimal-safe storage).
 * Plain JS floats give 0.1 + 0.2 = 0.30000000000000004; every money and
 * weight figure in this ERP is rounded through lib/calc/money so ledger
 * rows, invoices and payroll agree to the paisa/gram.
 */
import { describe, expect, it } from "vitest";
import { add, mul, roundMoney, roundTo, sub } from "@/lib/calc/money";

describe("decimal-safe arithmetic", () => {
  it("adds 0.1 + 0.2 to exactly 0.3", () => {
    expect(add(0.1, 0.2)).toBe(0.3);
  });

  it("subtracts and multiplies without float drift", () => {
    expect(sub(1.0, 0.3)).toBe(0.7);
    expect(mul(19.99, 3)).toBe(59.97);
  });

  it("rounds money to 2 decimals", () => {
    expect(roundMoney(2.5)).toBe(2.5);
    expect(roundMoney(10.126)).toBe(10.13);
  });

  it("maps non-finite input to 0 instead of propagating NaN", () => {
    expect(roundTo(NaN)).toBe(0);
    expect(roundTo(Infinity)).toBe(0);
  });
});
