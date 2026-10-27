/**
 * Gate-pass return restock decisions (spec §9): only accepted
 * quantity returns to stock; rejected quantity is recorded but
 * never credited. Rows without a decision behave as before
 * (accepted), so pre-migration returns are unaffected.
 */
import { describe, expect, it } from "vitest";
import { acceptedRestockQuantities } from "@/lib/calc/ledger";

describe("acceptedRestockQuantities", () => {
  it("restocks only accepted lines and drops rejected ones", () => {
    expect(
      acceptedRestockQuantities([
        { productId: "p1", partyId: null, qtyKg: 60, restockDecision: "accepted" },
        { productId: "p1", partyId: null, qtyKg: 40, restockDecision: "rejected" },
      ]),
    ).toEqual([{ productId: "p1", partyId: null, qtyKg: 60 }]);
  });

  it("treats a missing decision as accepted (legacy rows)", () => {
    expect(
      acceptedRestockQuantities([
        { productId: "p1", partyId: null, qtyKg: 25 },
        { productId: "p2", partyId: "owner-a", qtyKg: 10, restockDecision: null },
      ]),
    ).toEqual([
      { productId: "p1", partyId: null, qtyKg: 25 },
      { productId: "p2", partyId: "owner-a", qtyKg: 10 },
    ]);
  });

  it("returns nothing when every line is rejected", () => {
    expect(
      acceptedRestockQuantities([
        { productId: "p1", partyId: null, qtyKg: 100, restockDecision: "rejected" },
      ]),
    ).toEqual([]);
  });

  it("aggregates accepted lines per pool and keeps owners separate", () => {
    expect(
      acceptedRestockQuantities([
        { productId: "p1", partyId: null, qtyKg: 30, restockDecision: "accepted" },
        { productId: "p1", partyId: null, qtyKg: 20, restockDecision: "accepted" },
        { productId: "p1", partyId: "owner-a", qtyKg: 50, restockDecision: "accepted" },
      ]),
    ).toEqual([
      { productId: "p1", partyId: null, qtyKg: 50 },
      { productId: "p1", partyId: "owner-a", qtyKg: 50 },
    ]);
  });
});
