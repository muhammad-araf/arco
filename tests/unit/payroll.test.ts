/**
 * Payroll math (spec §13.2–§13.4, IMPLEMENTATION_PLAN Module 8).
 * - Daily: payable = eligible paid days x daily rate; a half day pays
 *   halfDayFactor (default 0.5) of a day.
 * - Monthly: fixed salary prorated by eligibleDays / daysInMonth, where
 *   daysInMonth is the real calendar month length (never assumed 30).
 * - Advance recovery is capped at the advance still owed.
 * - The rate used is the rate PASSED IN (the snapshot at pay-run time).
 *   Record-level retention (the payroll row storing that snapshot even
 *   after the employee's master rate changes) is a backend behaviour —
 *   see ACCEPTANCE.md (pending-backend).
 */
import { describe, expect, it } from "vitest";
import {
  advanceRecovery,
  computePayroll,
  dailyPay,
  monthlyProratedPay,
  overtimePay,
  pieceRatePay,
} from "@/lib/calc/payroll";

describe("dailyPay", () => {
  it("pays present days plus half days at half rate", () => {
    // 26 present + 2 half days = 27 paid days x 800 = 21600.
    expect(dailyPay(26, 2, 800)).toBe(21600);
  });

  it("pays present days only when there are no half days", () => {
    expect(dailyPay(20, 0, 500)).toBe(10000);
  });

  it("absent days contribute nothing", () => {
    // 22 present out of a longer month: only the 22 are paid.
    expect(dailyPay(22, 0, 500)).toBe(11000);
  });

  it("honours an explicit half-day factor", () => {
    expect(dailyPay(0, 4, 800, 0.5)).toBe(1600);
    expect(dailyPay(10, 2, 800, 0)).toBe(8000);
  });

  it("uses the rate passed in (snapshot semantics), not any 'current' rate", () => {
    // Same attendance, old rate 700 vs new rate 800: the pay run that
    // captured 700 must still compute 18200.
    expect(dailyPay(26, 0, 700)).toBe(18200);
    expect(dailyPay(26, 0, 800)).toBe(20800);
  });

  it("throws on negative inputs", () => {
    expect(() => dailyPay(-1, 0, 500)).toThrow(RangeError);
    expect(() => dailyPay(20, 0, -500)).toThrow(RangeError);
  });
});

describe("monthlyProratedPay", () => {
  it("prorates by eligible days over the real month length", () => {
    expect(monthlyProratedPay(30000, 20, 30)).toBe(20000);
    expect(monthlyProratedPay(30000, 14, 28)).toBe(15000);
  });

  it("pays the full salary for a full month (including February)", () => {
    expect(monthlyProratedPay(30000, 30, 30)).toBe(30000);
    expect(monthlyProratedPay(30000, 28, 28)).toBe(30000);
  });

  it("throws when daysInMonth is zero (never divide by an assumed month)", () => {
    expect(() => monthlyProratedPay(30000, 20, 0)).toThrow(RangeError);
  });
});

describe("overtimePay and pieceRatePay", () => {
  it("pays overtime hours x hourly rate", () => {
    expect(overtimePay(10, 150)).toBe(1500);
    expect(overtimePay(0, 150)).toBe(0);
  });

  it("pays piece-rate units x rate per unit", () => {
    expect(pieceRatePay(500, 12)).toBe(6000);
  });
});

describe("advanceRecovery", () => {
  it("recovers the requested amount when the balance covers it", () => {
    expect(advanceRecovery(5000, 3000)).toBe(3000);
  });

  it("never recovers more than the employee still owes", () => {
    expect(advanceRecovery(2000, 5000)).toBe(2000);
  });

  it("recovers nothing when there is no advance balance", () => {
    expect(advanceRecovery(0, 1000)).toBe(0);
  });
});

describe("computePayroll", () => {
  it("builds gross then net: base + overtime + bonus - advance - deductions", () => {
    const run = computePayroll({
      basePay: 21600,
      overtimeHours: 10,
      overtimeRatePerHour: 150,
      bonus: 2000,
      advanceBalance: 5000,
      advanceRecoveryRequested: 3000,
      deductions: 500,
    });
    expect(run).toEqual({
      basePay: 21600,
      overtimePay: 1500,
      bonus: 2000,
      grossPay: 25100,
      advanceRecovered: 3000,
      deductions: 500,
      netPayable: 21600,
    });
  });

  it("caps advance recovery inside the full run too", () => {
    const run = computePayroll({
      basePay: 10000,
      advanceBalance: 1000,
      advanceRecoveryRequested: 9000,
    });
    expect(run.advanceRecovered).toBe(1000);
    expect(run.netPayable).toBe(9000);
  });

  it("floors net payable at zero instead of a negative wage", () => {
    const run = computePayroll({ basePay: 1000, deductions: 5000 });
    expect(run.netPayable).toBe(0);
  });

  it("works with base pay alone (all other components optional)", () => {
    const run = computePayroll({ basePay: 15000 });
    expect(run.grossPay).toBe(15000);
    expect(run.netPayable).toBe(15000);
  });
});

describe("eligibleDays (payroll estimate from real attendance)", () => {
  it("counts present plus half days at half rate, holidays paid by default flag", async () => {
    const { eligibleDays } = await import("@/lib/calc/payroll");
    expect(eligibleDays({ present: 20, half_day: 2, leave: 3, absent: 2, holiday: 1 }, { leavePaid: false, holidayPaid: true })).toBe(22);
  });
  it("never counts absent days, and leave counts only when paid", async () => {
    const { eligibleDays } = await import("@/lib/calc/payroll");
    expect(eligibleDays({ present: 10, half_day: 0, leave: 5, absent: 5, holiday: 0 }, { leavePaid: true })).toBe(15);
    expect(eligibleDays({ present: 10, half_day: 0, leave: 5, absent: 5, holiday: 0 }, { leavePaid: false })).toBe(10);
  });
  it("throws on negative counts", async () => {
    const { eligibleDays } = await import("@/lib/calc/payroll");
    expect(() => eligibleDays({ present: -1, half_day: 0, leave: 0, absent: 0, holiday: 0 })).toThrow(RangeError);
  });
});
