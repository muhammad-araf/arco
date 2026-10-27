/**
 * Stock guard aggregation (QA B7 + gate-pass partial returns).
 * Guards run on quantities aggregated per (product, owner) pool, never
 * per line, and returns are validated cumulatively against dispatched
 * minus already-returned quantities.
 */
import { describe, expect, it } from "vitest";
import {
  aggregatePoolQuantities,
  gatePassStatusAfterReturn,
  ownersForProduct,
  remainingReturnable,
  validateCumulativeReturns,
} from "@/lib/calc/ledger";

describe("aggregatePoolQuantities", () => {
  it("sums duplicate lines for the same product and owner", () => {
    // B7 case: two 60 kg inward lines, one pool — guard must see 120, not 60.
    const agg = aggregatePoolQuantities([
      { productId: "p1", partyId: null, qtyKg: 60 },
      { productId: "p1", partyId: null, qtyKg: 60 },
    ]);
    expect(agg).toEqual([{ productId: "p1", partyId: null, qtyKg: 120 }]);
  });

  it("keeps different owners as separate pools", () => {
    const agg = aggregatePoolQuantities([
      { productId: "p1", partyId: "owner-a", qtyKg: 60 },
      { productId: "p1", partyId: null, qtyKg: 60 },
    ]);
    expect(agg).toHaveLength(2);
  });
});

describe("validateCumulativeReturns", () => {
  const dispatched = [
    { productId: "p1", partyId: null, qtyKg: 100 },
    { productId: "p1", partyId: "owner-a", qtyKg: 50 },
  ];

  it("rejects duplicate entries that jointly exceed dispatched", () => {
    const res = validateCumulativeReturns(dispatched, [], [
      { productId: "p1", partyId: null, qtyKg: 60 },
      { productId: "p1", partyId: null, qtyKg: 60 },
    ]);
    expect(res.ok).toBe(false);
  });

  it("counts prior returns cumulatively", () => {
    const prior = [{ productId: "p1", partyId: null, qtyKg: 60 }];
    expect(
      validateCumulativeReturns(dispatched, prior, [{ productId: "p1", partyId: null, qtyKg: 40 }]).ok,
    ).toBe(true);
    const over = validateCumulativeReturns(dispatched, prior, [
      { productId: "p1", partyId: null, qtyKg: 41 },
    ]);
    expect(over.ok).toBe(false);
  });

  it("rejects a return from a pool the product was not dispatched from", () => {
    const res = validateCumulativeReturns(dispatched, [], [
      { productId: "p1", partyId: "owner-b", qtyKg: 10 },
    ]);
    expect(res.ok).toBe(false);
  });

  it("rejects zero or negative returns", () => {
    expect(validateCumulativeReturns(dispatched, [], [{ productId: "p1", partyId: null, qtyKg: 0 }]).ok).toBe(false);
  });
});

describe("remainingReturnable", () => {
  it("returns dispatched minus prior, per pool, dropping exhausted pools", () => {
    const rem = remainingReturnable(
      [
        { productId: "p1", partyId: null, qtyKg: 100 },
        { productId: "p2", partyId: null, qtyKg: 30 },
      ],
      [{ productId: "p2", partyId: null, qtyKg: 30 }],
    );
    expect(rem).toEqual([{ productId: "p1", partyId: null, qtyKg: 100 }]);
  });
});

describe("gatePassStatusAfterReturn", () => {
  it("is partially_returned while any quantity remains", () => {
    expect(gatePassStatusAfterReturn(100, 40)).toBe("partially_returned");
  });

  it("is returned only when the full dispatched quantity is back", () => {
    expect(gatePassStatusAfterReturn(100, 100)).toBe("returned");
  });
});

describe("ownersForProduct", () => {
  it("lists distinct owners for a product", () => {
    expect(
      ownersForProduct(
        [
          { productId: "p1", partyId: null, qtyKg: 10 },
          { productId: "p1", partyId: "owner-a", qtyKg: 10 },
          { productId: "p1", partyId: "owner-a", qtyKg: 5 },
        ],
        "p1",
      ),
    ).toEqual([null, "owner-a"]);
  });
});
