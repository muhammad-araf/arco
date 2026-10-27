/**
 * Finance fix-program tests (QA blockers B5/B6 + finance majors):
 * date-bound handling, duplicate allocation aggregation, customer
 * balances net of unapplied advances, signed party openings, and
 * receipt amounts in words. Pure functions only — no DB access.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateAllocations,
  amountInWordsPKR,
  customerBalanceNetOfAdvances,
  exclusiveToBound,
  signedPartyOpening,
} from "@/lib/calc/finance";

describe("exclusiveToBound (B5: the `to` day must not be dropped)", () => {
  it("turns a plain YYYY-MM-DD into the next day for a `<` bound", () => {
    expect(exclusiveToBound("2026-10-27")).toBe("2026-10-28");
  });

  it("rolls month and year ends over", () => {
    expect(exclusiveToBound("2026-10-31")).toBe("2026-11-01");
    expect(exclusiveToBound("2026-12-31")).toBe("2027-01-01");
    expect(exclusiveToBound("2024-02-29")).toBe("2024-03-01");
  });

  it("leaves a full timestamp untouched", () => {
    expect(exclusiveToBound("2026-10-27T15:30:00.000Z")).toBe("2026-10-27T15:30:00.000Z");
  });

  it("a plain date bound used with `<` keeps the whole `to` day", () => {
    // Rows at any time on 2026-10-27 are < 2026-10-28, but were
    // excluded by the old `.lte("date", "2026-10-27")` (= midnight).
    const bound = exclusiveToBound("2026-10-27");
    expect("2026-10-27T23:59:00.000Z" < bound).toBe(true);
    expect("2026-10-28T00:00:00.000Z" < bound).toBe(false);
  });
});

describe("aggregateAllocations (duplicate targets in one payment)", () => {
  it("sums two lines to the same purchase", () => {
    expect(
      aggregateAllocations([
        { targetType: "purchase", targetId: "p1", amount: 60000 },
        { targetType: "purchase", targetId: "p1", amount: 60000 },
      ]),
    ).toEqual([{ targetType: "purchase", targetId: "p1", amount: 120000 }]);
  });

  it("keeps distinct targets separate and preserves first-seen order", () => {
    expect(
      aggregateAllocations([
        { targetType: "purchase", targetId: "p1", amount: 100 },
        { targetType: "expense", targetId: "e1", amount: 50 },
        { targetType: "purchase", targetId: "p1", amount: 25 },
      ]),
    ).toEqual([
      { targetType: "purchase", targetId: "p1", amount: 125 },
      { targetType: "expense", targetId: "e1", amount: 50 },
    ]);
  });

  it("rounds the merged total to 2 decimals", () => {
    expect(
      aggregateAllocations([
        { targetType: "purchase", targetId: "p1", amount: 0.1 },
        { targetType: "purchase", targetId: "p1", amount: 0.2 },
      ]),
    ).toEqual([{ targetType: "purchase", targetId: "p1", amount: 0.3 }]);
  });
});

describe("customerBalanceNetOfAdvances (billing)", () => {
  it("subtracts unapplied receipts on top of invoice balances", () => {
    // Invoice 100000, allocated 80000 (balance 20000), receipt total
    // 100000 with 20000 unapplied: true balance is 0, not 20000.
    expect(customerBalanceNetOfAdvances(0, [20000], [20000])).toBe(0);
  });

  it("a fully unapplied receipt is an advance (negative balance)", () => {
    expect(customerBalanceNetOfAdvances(50000, [], [80000])).toBe(-30000);
  });

  it("keeps the opening and leaves allocated receipts out (already in invoice balances)", () => {
    expect(customerBalanceNetOfAdvances(10000, [40000], [])).toBe(50000);
  });
});

describe("signedPartyOpening", () => {
  it("is positive for receivable, negative for payable", () => {
    expect(signedPartyOpening(10000, "receivable")).toBe(10000);
    expect(signedPartyOpening(10000, "payable")).toBe(-10000);
  });

  it("an already-negative evidence amount keeps its own sign", () => {
    expect(signedPartyOpening(-5000, "receivable")).toBe(-5000);
  });
});

describe("amountInWordsPKR (receipt voucher)", () => {
  it("renders whole rupees", () => {
    expect(amountInWordsPKR(100000)).toBe("One Lakh Rupees only");
  });

  it("renders rupees and paise", () => {
    expect(amountInWordsPKR(1234.5)).toBe("One Thousand Two Hundred Thirty Four Rupees and Fifty Paise only");
  });

  it("renders zero and singular rupee", () => {
    expect(amountInWordsPKR(0)).toBe("Zero Rupees only");
    expect(amountInWordsPKR(1)).toBe("One Rupee only");
  });

  it("renders crores", () => {
    expect(amountInWordsPKR(25000000)).toBe("Two Crore Fifty Lakh Rupees only");
  });
});
