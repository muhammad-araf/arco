/**
 * Payroll math — also used by the finance agent's payroll module, so
 * signatures are kept stable and every rule that the client spec marks
 * configurable is a parameter, not a buried constant:
 * - half-day conversion factor (default 0.5 = a half day pays half a day)
 * - days-in-month for monthly proration (caller supplies the real calendar
 *   month length; it is never assumed to be 30)
 * - overtime rate per hour (caller supplies it; no hourly derivation from a
 *   monthly salary is invented here, because the work-hours-per-day rule
 *   is itself a client-confirmation item)
 */
import { roundMoney, assertNonNegative } from "./money";

/** Daily-wage pay: full days + half days x halfDayFactor, all x daily rate. */
export function dailyPay(
  presentDays: number,
  halfDays: number,
  dailyRate: number,
  halfDayFactor = 0.5,
): number {
  assertNonNegative(presentDays, "presentDays");
  assertNonNegative(halfDays, "halfDays");
  assertNonNegative(dailyRate, "dailyRate");
  if (!Number.isFinite(halfDayFactor) || halfDayFactor < 0 || halfDayFactor > 1) {
    throw new RangeError("halfDayFactor must be between 0 and 1");
  }
  return roundMoney((presentDays + halfDays * halfDayFactor) * dailyRate);
}

/** Monthly-salary proration: salary x eligibleDays / daysInMonth. */
export function monthlyProratedPay(
  monthlySalary: number,
  eligibleDays: number,
  daysInMonth: number,
): number {
  assertNonNegative(monthlySalary, "monthlySalary");
  assertNonNegative(eligibleDays, "eligibleDays");
  if (!Number.isFinite(daysInMonth) || daysInMonth <= 0) {
    throw new RangeError("daysInMonth must be > 0");
  }
  return roundMoney((monthlySalary * eligibleDays) / daysInMonth);
}

/** Overtime pay: hours x rate per hour. */
export function overtimePay(hours: number, ratePerHour: number): number {
  assertNonNegative(hours, "hours");
  assertNonNegative(ratePerHour, "ratePerHour");
  return roundMoney(hours * ratePerHour);
}

/** Piece-rate pay: units produced/handled x rate per unit. */
export function pieceRatePay(units: number, ratePerUnit: number): number {
  assertNonNegative(units, "units");
  assertNonNegative(ratePerUnit, "ratePerUnit");
  return roundMoney(units * ratePerUnit);
}

/**
 * Advance recovery for one pay run: never recover more than the employee
 * still owes, and never more than the caller asked to recover.
 */
export function advanceRecovery(
  advanceBalance: number,
  requestedRecovery: number,
): number {
  assertNonNegative(advanceBalance, "advanceBalance");
  assertNonNegative(requestedRecovery, "requestedRecovery");
  return roundMoney(Math.min(advanceBalance, requestedRecovery));
}

export interface PayrollBreakdown {
  basePay: number;
  overtimePay: number;
  bonus: number;
  grossPay: number;
  advanceRecovered: number;
  deductions: number;
  netPayable: number;
}

export interface ComputePayrollInput {
  /** Base pay for the period (from dailyPay / monthlyProratedPay / pieceRatePay). */
  basePay: number;
  overtimeHours?: number;
  overtimeRatePerHour?: number;
  bonus?: number;
  /** Advance still owed at the start of this run. */
  advanceBalance?: number;
  /** Advance the caller wants to recover this run (capped by the balance). */
  advanceRecoveryRequested?: number;
  /** Other deductions (excluding advance recovery). */
  deductions?: number;
}

/** Full pay-run breakdown: gross = base + overtime + bonus; net = gross - advance - deductions. */
export function computePayroll(input: ComputePayrollInput): PayrollBreakdown {
  const basePay = roundMoney(input.basePay);
  if (basePay < 0) throw new RangeError("basePay must be >= 0");
  const ot = overtimePay(input.overtimeHours ?? 0, input.overtimeRatePerHour ?? 0);
  const bonus = roundMoney(input.bonus ?? 0);
  if (bonus < 0) throw new RangeError("bonus must be >= 0");
  const grossPay = roundMoney(basePay + ot + bonus);
  const advanceRecovered = advanceRecovery(
    input.advanceBalance ?? 0,
    input.advanceRecoveryRequested ?? 0,
  );
  const deductions = roundMoney(input.deductions ?? 0);
  if (deductions < 0) throw new RangeError("deductions must be >= 0");
  const netPayable = Math.max(0, roundMoney(grossPay - advanceRecovered - deductions));
  return { basePay, overtimePay: ot, bonus, grossPay, advanceRecovered, deductions, netPayable };
}
