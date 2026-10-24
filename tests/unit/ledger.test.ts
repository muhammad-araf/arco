/**
 * Ledger arithmetic (spec §5.2 single-ledger rule, §12.3 daybook formula).
 * Balances are derived from rows, never stored as editable totals.
 * NOTE: these helpers do arithmetic only. The stock guard (blocking an
 * outward posting that would drive stock negative) and exact-once posting
 * are server-action behaviours — see ACCEPTANCE.md (pending-backend).
 */
import { describe, expect, it } from "vitest";
import {
  cashRunningBalance,
  daybookClosing,
  ledgerRunningBalance,
  stockBalanceFromRows,
} from "@/lib/calc/ledger";

describe("ledgerRunningBalance (one stock_ledger row: prev + in - out)", () => {
  it("adds inward and subtracts outward", () => {
    expect(ledgerRunningBalance(100, 50, 30)).toBe(120);
  });

  it("folds a realistic in/out sequence correctly", () => {
    let balance = 200;
    balance = ledgerRunningBalance(balance, 50, 0); // inward -> 250
    balance = ledgerRunningBalance(balance, 0, 30); // dispatch -> 220
    balance = ledgerRunningBalance(balance, 0, 220); // dispatch -> 0
    expect(balance).toBe(0);
  });

  it("does NOT clamp at the calc level (the posting guard lives upstream)", () => {
    // A negative result here means the server action must have blocked it.
    expect(ledgerRunningBalance(10, 0, 25)).toBe(-15);
  });
});

describe("stockBalanceFromRows", () => {
  it("sums inward - outward over rows", () => {
    expect(
      stockBalanceFromRows([
        { inward_qty: 100, outward_qty: 0 },
        { inward_qty: 0, outward_qty: 30 },
        { inward_qty: 50, outward_qty: 20 },
      ]),
    ).toBe(100);
  });

  it("is zero with no rows", () => {
    expect(stockBalanceFromRows([])).toBe(0);
  });
});

describe("daybookClosing (opening + receipts - payments)", () => {
  it("computes the spec §12.3 formula", () => {
    expect(daybookClosing(5000, 12000, 7000)).toBe(10000);
  });

  it("is zero when nothing moved", () => {
    expect(daybookClosing(0, 0, 0)).toBe(0);
  });

  it("shows an overdraft as negative rather than hiding it", () => {
    expect(daybookClosing(1000, 500, 2000)).toBe(-500);
  });
});

describe("cashRunningBalance (one cash_ledger row: prev + debit - credit)", () => {
  it("tracks a receipt then an expense", () => {
    let balance = 5000;
    balance = cashRunningBalance(balance, 2000, 0); // receipt -> 7000
    balance = cashRunningBalance(balance, 0, 750); // expense -> 6250
    expect(balance).toBe(6250);
  });
});
