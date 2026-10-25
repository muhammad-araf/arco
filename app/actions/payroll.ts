"use server";

/**
 * Attendance & payroll server actions (spec §13).
 *
 * Rules that the spec marks "client confirmation" are NOT hard-coded:
 * they live in the app_settings 'payroll_rules' row (see
 * supabase/schema-finance.sql) and are read at run time. The seeded
 * values are placeholders pending client sign-off — weekly_off_days,
 * half_day_factor, leave_paid, holiday_paid, monthly_mode and the
 * proration denominator. Changing a rule changes FUTURE runs only:
 * every payroll row stores the applied_rate actually used, so a later
 * employee-rate change can never rewrite history (§13.1).
 *
 * Payroll arithmetic uses @/lib/calc (dailyPay, monthlyProratedPay,
 * pieceRatePay, computePayroll): base + overtime + bonus − advance
 * recovery − deductions (+ previous balance carried in, which is a
 * signed amount owed to the employee from a prior period).
 *
 * Attendance: one row per employee/date (unique constraint). A second
 * mark is an error — corrections go through correctAttendance with a
 * mandatory reason + audit entry. Payroll periods lock on approval;
 * later corrections use adjustPayroll (audited) or a reversal.
 *
 * Roles: attendance + runs + approvals are Owner/Admin + HR/payroll;
 * paying may also be done by Accountant (cash handling); reads are
 * Owner/Admin + HR/payroll + Accountant. Salary detail never goes to
 * storekeeper / production / gate / read-only roles.
 */

import {
  getDb,
  requireRole,
  type ActionResult,
  type Actor,
} from "./auth";
import {
  errMsg,
  PAYROLL_WRITE,
  PAYROLL_PAY,
  PAYROLL_READ,
} from "./auth-helpers";
import { logAudit } from "@/lib/audit";
import {
  roundMoney,
  dailyPay,
  monthlyProratedPay,
  pieceRatePay,
  computePayroll,
  cashRunningBalance,
} from "@/lib/calc";

type Db = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

function fail(error: string): ActionResult {
  return { success: false, error };
}

async function requireWrite(db: Db): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireRole(db, PAYROLL_WRITE);
  if (!gate.ok) return { error: gate.error };
  return { actor: gate.actor };
}

async function requirePay(db: Db): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireRole(db, PAYROLL_PAY);
  if (!gate.ok) return { error: gate.error };
  return { actor: gate.actor };
}

async function requireRead(db: Db): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireRole(db, PAYROLL_READ);
  if (!gate.ok) return { error: gate.error };
  return { actor: gate.actor };
}

export interface PayrollRules {
  weeklyOffDays: number[]; // 0 = Sunday … 6 = Saturday, client-configured
  weeklyOffPaid: boolean;
  halfDayFactor: number;
  leavePaid: boolean;
  holidayPaid: boolean;
  monthlyMode: "fixed" | "prorated";
  prorationDenominator: "calendar" | "working";
  overtimeRatePerHour: number | null;
}

const DEFAULT_RULES: PayrollRules = {
  weeklyOffDays: [],
  weeklyOffPaid: false,
  halfDayFactor: 0.5,
  leavePaid: false,
  holidayPaid: true,
  monthlyMode: "fixed",
  prorationDenominator: "calendar",
  overtimeRatePerHour: null,
};

async function getPayrollRules(db: Db): Promise<PayrollRules> {
  const { data } = await db.from("app_settings").select("value").eq("key", "payroll_rules").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return {
    weeklyOffDays: Array.isArray(v.weekly_off_days) ? (v.weekly_off_days as number[]) : DEFAULT_RULES.weeklyOffDays,
    weeklyOffPaid: typeof v.weekly_off_paid === "boolean" ? v.weekly_off_paid : DEFAULT_RULES.weeklyOffPaid,
    halfDayFactor: typeof v.half_day_factor === "number" ? v.half_day_factor : DEFAULT_RULES.halfDayFactor,
    leavePaid: typeof v.leave_paid === "boolean" ? v.leave_paid : DEFAULT_RULES.leavePaid,
    holidayPaid: typeof v.holiday_paid === "boolean" ? v.holiday_paid : DEFAULT_RULES.holidayPaid,
    monthlyMode: v.monthly_mode === "prorated" ? "prorated" : "fixed",
    prorationDenominator: v.proration_denominator === "working" ? "working" : "calendar",
    overtimeRatePerHour: typeof v.overtime_rate_per_hour === "number" ? v.overtime_rate_per_hour : null,
  };
}

/** Update the configurable payroll rules — Owner/Admin only. */
export async function updatePayrollRules(
  rules: Partial<PayrollRules>,
  reason: string,
): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireRole(db, ["owner_admin"]);
  if (!gate.ok) return fail(gate.error);
  if (!reason?.trim()) return fail("A reason is required to change payroll rules.");
  const current = await getPayrollRules(db);
  const next: PayrollRules = { ...current, ...rules };
  const value = {
    weekly_off_days: next.weeklyOffDays,
    weekly_off_paid: next.weeklyOffPaid,
    half_day_factor: next.halfDayFactor,
    leave_paid: next.leavePaid,
    holiday_paid: next.holidayPaid,
    monthly_mode: next.monthlyMode,
    proration_denominator: next.prorationDenominator,
    overtime_rate_per_hour: next.overtimeRatePerHour,
  };
  const { data, error: uError } = await db
    .from("app_settings")
    .upsert({ key: "payroll_rules", value, updated_by: gate.actor.userId })
    .select()
    .single();
  if (uError) return fail(uError.message);
  await logAudit(db, {
    action: "permission_change", entityType: "app_settings", entityId: "payroll_rules",
    before: current as unknown as Record<string, unknown>,
    after: value as unknown as Record<string, unknown>,
    reason, userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data };
}

// ---------------------------------------------------------------- attendance

export type AttendanceStatus = "present" | "absent" | "half_day" | "leave" | "holiday";

export async function markAttendance(input: {
  employeeId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  overtimeHours?: number;
  notes?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  const ot = input.overtimeHours ?? 0;
  if (!Number.isFinite(ot) || ot < 0) return fail("overtimeHours must be >= 0.");
  const { data, error: iError } = await db
    .from("attendance")
    .insert({
      employee_id: input.employeeId, date: input.date, status: input.status,
      overtime_hours: ot, notes: input.notes ?? null, created_by: gate.actor.userId,
    })
    .select()
    .single();
  if (iError) {
    if (iError.message.includes("duplicate") || iError.code === "23505") {
      return fail("Attendance already exists for this employee and date. Use correctAttendance with a reason to change it.");
    }
    return fail(iError.message);
  }
  await logAudit(db, {
    action: "create", entityType: "attendance", entityId: data.id,
    after: { employee_id: input.employeeId, date: input.date, status: input.status },
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data };
}

export async function correctAttendance(input: {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  overtimeHours?: number;
  reason: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!input.reason?.trim()) return fail("A reason is mandatory for attendance corrections.");
  const { data: before } = await db.from("attendance").select("*")
    .eq("employee_id", input.employeeId).eq("date", input.date).maybeSingle();
  if (!before) return fail("No attendance row exists for this employee and date — mark it first.");
  const ot = input.overtimeHours ?? Number(before.overtime_hours) ?? 0;
  if (!Number.isFinite(ot) || ot < 0) return fail("overtimeHours must be >= 0.");
  const { data, error: uError } = await db
    .from("attendance")
    .update({
      status: input.status, overtime_hours: ot,
      correction_reason: input.reason, updated_by: gate.actor.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", before.id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  await logAudit(db, {
    action: "attendance_correction", entityType: "attendance", entityId: before.id,
    before: { status: before.status, overtime_hours: before.overtime_hours },
    after: { status: input.status, overtime_hours: ot },
    reason: input.reason, userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data };
}

export async function listAttendance(filters: {
  employeeId?: string;
  from?: string;
  to?: string;
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireRead(db);
  if ("error" in gate) return fail(gate.error);
  let q = db.from("attendance").select("employee_id, date, status").order("date", { ascending: true });
  if (filters.employeeId) q = q.eq("employee_id", filters.employeeId);
  if (filters.from) q = q.gte("date", filters.from);
  if (filters.to) q = q.lte("date", filters.to);
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}

export async function getAttendanceSummary(input: {
  employeeId?: string;
  from: string;
  to: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireRead(db);
  if ("error" in gate) return fail(gate.error);
  let q = db.from("attendance").select("employee_id, status, overtime_hours")
    .gte("date", input.from).lte("date", input.to);
  if (input.employeeId) q = q.eq("employee_id", input.employeeId);
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  const byEmployee = new Map<string, Record<string, number>>();
  for (const r of data ?? []) {
    const row = byEmployee.get(r.employee_id) ?? {
      present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0, overtime_hours: 0, total: 0,
    };
    row[r.status as string] = (row[r.status as string] ?? 0) + 1;
    row.overtime_hours = roundMoney(row.overtime_hours + (Number(r.overtime_hours) || 0));
    row.total += 1;
    byEmployee.set(r.employee_id, row);
  }
  return {
    success: true,
    data: { from: input.from, to: input.to, employees: [...byEmployee.entries()].map(([employeeId, counts]) => ({ employeeId, ...counts })) },
  };
}

// ---------------------------------------------------------------- payroll runs

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export async function runPayroll(input: {
  employeeId: string;
  month: number;
  year: number;
  bonus?: number;
  advanceRecoveryRequested?: number;
  deductions?: number;
  previousBalance?: number;
  overtimeRatePerHour?: number;
  pieces?: number;
  notes?: string;
  clientToken?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  try {
    if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
      return fail("month must be 1–12.");
    }
    if (input.clientToken) {
      const { data: existing } = await db.from("payroll_periods").select("*")
        .eq("client_token", input.clientToken).maybeSingle();
      if (existing) return { success: true, data: existing };
    }
    const { data: employee } = await db.from("employees").select("*").eq("id", input.employeeId).maybeSingle();
    if (!employee) return fail("Employee not found.");
    const { data: live } = await db.from("payroll_periods").select("id, status")
      .eq("employee_id", input.employeeId).eq("month", input.month).eq("year", input.year)
      .neq("status", "reversed").maybeSingle();
    if (live) return fail(`A live payroll run already exists for this employee and period (status: ${live.status}). Reverse it first, or adjust it.`);
    const rules = await getPayrollRules(db);
    const start = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
    const end = `${input.year}-${String(input.month).padStart(2, "0")}-${daysInMonth(input.year, input.month)}`;
    const { data: rows } = await db.from("attendance").select("*")
      .eq("employee_id", input.employeeId).gte("date", start).lte("date", end);
    let present = 0;
    let half = 0;
    let leave = 0;
    let absent = 0;
    let holiday = 0;
    let overtimeHours = 0;
    const markedDates = new Set<string>();
    for (const r of rows ?? []) {
      markedDates.add(r.date as string);
      overtimeHours = roundMoney(overtimeHours + (Number(r.overtime_hours) || 0));
      if (r.status === "present") present += 1;
      else if (r.status === "half_day") half += 1;
      else if (r.status === "leave") leave += 1;
      else if (r.status === "absent") absent += 1;
      else if (r.status === "holiday") holiday += 1;
    }
    // Configurable weekly-off days with NO attendance row: paid only when
    // the (client-confirmable) weekly_off_paid rule says so.
    let weeklyOffPaidDays = 0;
    if (rules.weeklyOffPaid && rules.weeklyOffDays.length) {
      const dim = daysInMonth(input.year, input.month);
      for (let d = 1; d <= dim; d++) {
        const iso = `${input.year}-${String(input.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (markedDates.has(iso)) continue;
        if (rules.weeklyOffDays.includes(new Date(input.year, input.month - 1, d).getDay())) {
          weeklyOffPaidDays += 1;
        }
      }
    }
    const paidDays = present + half * rules.halfDayFactor
      + (rules.leavePaid ? leave : 0)
      + (rules.holidayPaid ? holiday : 0)
      + weeklyOffPaidDays;
    const payableDays = roundMoney(paidDays);
    // HISTORICAL snapshot: the employee's rate at run time.
    const appliedRate = roundMoney(Number(employee.base_rate) || 0);
    let basePay: number;
    const warnings: string[] = [];
    if (employee.pay_type === "daily") {
      basePay = dailyPay(present + weeklyOffPaidDays, half, appliedRate, rules.halfDayFactor);
      // dailyPay counts present + half-day; leave/holiday paid days are
      // added at the same daily rate when the rules mark them paid.
      if (rules.leavePaid && leave) basePay = roundMoney(basePay + leave * appliedRate);
      if (rules.holidayPaid && holiday) basePay = roundMoney(basePay + holiday * appliedRate);
    } else if (employee.pay_type === "monthly") {
      if (rules.monthlyMode === "prorated") {
        const dim = daysInMonth(input.year, input.month);
        let denom = dim;
        if (rules.prorationDenominator === "working" && rules.weeklyOffDays.length) {
          let off = 0;
          for (let d = 1; d <= dim; d++) {
            if (rules.weeklyOffDays.includes(new Date(input.year, input.month - 1, d).getDay())) off += 1;
          }
          denom = Math.max(1, dim - off);
        }
        basePay = monthlyProratedPay(appliedRate, payableDays, denom);
      } else {
        basePay = roundMoney(appliedRate);
      }
    } else {
      // piece_rate: pieces x rate when pieces are supplied; otherwise fall
      // back to payable days x rate and say so (piece counts are not
      // tracked by attendance alone).
      if (input.pieces !== undefined) {
        basePay = pieceRatePay(input.pieces, appliedRate);
      } else {
        warnings.push("Piece-rate employee run without a pieces count: base pay falls back to payable days x rate. Supply pieces for a true piece-rate run.");
        basePay = dailyPay(present, half, appliedRate, rules.halfDayFactor);
      }
    }
    const overtimeRate = input.overtimeRatePerHour ?? rules.overtimeRatePerHour ?? 0;
    if (overtimeHours > 0 && overtimeRate === 0) {
      warnings.push("Overtime hours exist but no overtime rate was supplied or configured — overtime pay is 0.");
    }
    const bonus = roundMoney(input.bonus ?? 0);
    const deductions = roundMoney(input.deductions ?? 0);
    if (bonus < 0 || deductions < 0) return fail("Bonus and deductions must be >= 0.");
    // Advance recovery is capped by the employee's open advance balance.
    const { data: advances } = await db.from("employee_advances").select("amount, recovered_amount")
      .eq("employee_id", input.employeeId).eq("status", "open");
    const advanceBalance = (advances ?? []).reduce(
      (s, a) => roundMoney(s + (Number(a.amount) || 0) - (Number(a.recovered_amount) || 0)), 0);
    const breakdown = computePayroll({
      basePay,
      overtimeHours,
      overtimeRatePerHour: overtimeRate,
      bonus,
      advanceBalance,
      advanceRecoveryRequested: input.advanceRecoveryRequested ?? 0,
      deductions,
    });
    const previousBalance = roundMoney(input.previousBalance ?? 0);
    const netPayable = Math.max(0, roundMoney(breakdown.netPayable + previousBalance));
    const { data, error: iError } = await db
      .from("payroll_periods")
      .insert({
        employee_id: input.employeeId, period_start: start, period_end: end,
        month: input.month, year: input.year, pay_type: employee.pay_type,
        applied_rate: appliedRate, payable_days: payableDays,
        present_days: present, half_days: half, leave_days: leave,
        absent_days: absent, holiday_days: holiday,
        overtime_hours: overtimeHours, base_pay: breakdown.basePay,
        overtime_pay: breakdown.overtimePay, bonus: breakdown.bonus,
        advance_recovery: breakdown.advanceRecovered, deductions: breakdown.deductions,
        previous_balance: previousBalance, gross_pay: breakdown.grossPay,
        net_payable: netPayable, paid_amount: 0, balance_amount: netPayable,
        status: "draft", client_token: input.clientToken ?? null,
        notes: input.notes ?? null, created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError) return fail(iError.message);
    if (breakdown.advanceRecovered > 0) {
      // Apply the recovery against open advances, oldest first.
      let remaining = breakdown.advanceRecovered;
      const { data: openAdv } = await db.from("employee_advances").select("*")
        .eq("employee_id", input.employeeId).eq("status", "open").order("date", { ascending: true });
      for (const adv of openAdv ?? []) {
        if (remaining <= 0) break;
        const owed = roundMoney(Number(adv.amount) - Number(adv.recovered_amount));
        const take = Math.min(owed, remaining);
        remaining = roundMoney(remaining - take);
        const recovered = roundMoney(Number(adv.recovered_amount) + take);
        await db.from("employee_advances").update({
          recovered_amount: recovered,
          status: recovered >= Number(adv.amount) ? "recovered" : "open",
        }).eq("id", adv.id);
      }
    }
    await logAudit(db, {
      action: "create", entityType: "payroll_periods", entityId: data.id,
      after: {
        employee_id: input.employeeId, month: input.month, year: input.year,
        applied_rate: appliedRate, payable_days: payableDays, net_payable: netPayable,
        status: "draft",
      },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: { ...data, warnings, rulesApplied: rules } };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function listPayroll(filters: {
  employeeId?: string;
  month?: number;
  year?: number;
  status?: string;
} = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireRead(db);
  if ("error" in gate) return fail(gate.error);
  let q = db.from("payroll_periods").select("*").order("year", { ascending: false }).order("month", { ascending: false });
  if (filters.employeeId) q = q.eq("employee_id", filters.employeeId);
  if (filters.month) q = q.eq("month", filters.month);
  if (filters.year) q = q.eq("year", filters.year);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}

export async function approvePayroll(id: string, opts: { note?: string } = {}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  const { data: period } = await db.from("payroll_periods").select("*").eq("id", id).single();
  if (!period) return fail("Payroll period not found.");
  if (period.status !== "draft") return fail(`Only a draft payroll can be approved (status: ${period.status}).`);
  const { data: updated, error: uError } = await db
    .from("payroll_periods")
    .update({ status: "approved", approved_by: gate.actor.userId, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select()
    .single();
  if (uError || !updated) return fail("Payroll could not be approved (concurrent change?).");
  await logAudit(db, {
    action: "approve", entityType: "payroll_periods", entityId: id,
    before: { status: "draft" }, after: { status: "approved", net_payable: period.net_payable },
    reason: opts.note ?? null, userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data: updated };
}

/**
 * Authorized adjustment to an APPROVED (not fully paid) payroll: the
 * period stays locked otherwise. The adjustment changes net/balance by
 * exactly `delta` and is audited with a mandatory reason.
 */
export async function adjustPayroll(
  id: string,
  delta: number,
  reason: string,
): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!reason?.trim()) return fail("A reason is mandatory for payroll adjustments.");
  if (!Number.isFinite(delta)) return fail("delta must be a finite number.");
  const { data: period } = await db.from("payroll_periods").select("*").eq("id", id).single();
  if (!period) return fail("Payroll period not found.");
  if (!["approved", "partially_paid"].includes(period.status)) {
    return fail(`Only an approved, unpaid payroll can be adjusted (status: ${period.status}).`);
  }
  const net = roundMoney(Number(period.net_payable) + delta);
  if (net < Number(period.paid_amount)) {
    return fail("Adjustment would take net payable below amounts already paid.");
  }
  const { data: updated, error: uError } = await db
    .from("payroll_periods")
    .update({
      adjustment_amount: roundMoney(Number(period.adjustment_amount) + delta),
      net_payable: net,
      balance_amount: roundMoney(net - Number(period.paid_amount)),
    })
    .eq("id", id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  await logAudit(db, {
    action: "payroll_adjustment", entityType: "payroll_periods", entityId: id,
    before: { net_payable: period.net_payable },
    after: { net_payable: net, adjustment_delta: delta },
    reason, userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data: updated };
}

/**
 * Pay a payroll period. Multiple partial payments are allowed; each
 * keeps its own date/method/reference. When a cash account is given,
 * the outflow is recorded once in cash_ledger as a payroll settlement
 * (distinct from purchase/expense settlements). paid_amount is
 * maintained incrementally — payroll_payments rows are the history.
 */
export async function payPayroll(input: {
  payrollId: string;
  amount: number;
  date?: string;
  paymentMethod?: string;
  cashAccountId?: string | null;
  account?: "cash" | "bank" | "online";
  referenceNo?: string;
  notes?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requirePay(db);
  if ("error" in gate) return fail(gate.error);
  try {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return fail("Payment amount must be > 0.");
    const { data: period } = await db.from("payroll_periods").select("*").eq("id", input.payrollId).single();
    if (!period) return fail("Payroll period not found.");
    if (!["approved", "partially_paid"].includes(period.status)) {
      return fail(`Only an approved payroll can be paid (status: ${period.status}).`);
    }
    if (amount > Number(period.balance_amount)) {
      return fail(`Payment (${amount}) exceeds the unpaid balance (${period.balance_amount}).`);
    }
    const date = input.date ?? new Date().toISOString();
    const { data: payment, error: iError } = await db
      .from("payroll_payments")
      .insert({
        payroll_id: input.payrollId, date, amount: roundMoney(amount),
        payment_method: input.paymentMethod ?? "cash",
        cash_account_id: input.cashAccountId ?? null, account: input.account ?? null,
        reference_no: input.referenceNo ?? null, notes: input.notes ?? null,
        created_by: gate.actor.userId,
      })
      .select()
      .single();
    if (iError) return fail(iError.message);
    if (input.cashAccountId || input.account) {
      const kind = input.account ?? "cash";
      let acctId = input.cashAccountId ?? null;
      let prevBal = 0;
      if (acctId) {
        const { data: last } = await db.from("cash_ledger").select("running_balance")
          .eq("cash_account_id", acctId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        prevBal = last ? Number(last.running_balance) || 0 : 0;
      } else {
        const { data: last } = await db.from("cash_ledger").select("running_balance")
          .eq("account", kind).order("created_at", { ascending: false }).limit(1).maybeSingle();
        prevBal = last ? Number(last.running_balance) || 0 : 0;
      }
      const { error: cError } = await db.from("cash_ledger").insert({
        date, voucher_type: "payroll", voucher_id: payment.id,
        voucher_no: `PAYROLL-${period.year}-${String(period.month).padStart(2, "0")}`,
        account: kind, cash_account_id: acctId, debit: 0, credit: roundMoney(amount),
        running_balance: cashRunningBalance(prevBal, 0, roundMoney(amount)),
        description: `Salary payment — employee ${period.employee_id}`,
        settlement_kind: "payroll", created_by: gate.actor.userId,
      });
      if (cError) return fail(cError.message);
    }
    const paid = roundMoney(Number(period.paid_amount) + amount);
    const balance = roundMoney(Number(period.net_payable) - paid);
    const { data: updated, error: uError } = await db
      .from("payroll_periods")
      .update({
        paid_amount: paid, balance_amount: balance,
        status: balance <= 0 ? "paid" : "partially_paid",
      })
      .eq("id", input.payrollId)
      .select()
      .single();
    if (uError) return fail(uError.message);
    await logAudit(db, {
      action: "pay", entityType: "payroll_periods", entityId: input.payrollId,
      before: { paid_amount: period.paid_amount, balance_amount: period.balance_amount },
      after: { paid_amount: paid, balance_amount: balance },
      reason: input.referenceNo ?? null, userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    return { success: true, data: updated };
  } catch (err) {
    return fail(errMsg(err));
  }
}

export async function reversePayroll(id: string, reason: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  if (!reason?.trim()) return fail("A reason is mandatory to reverse a payroll period.");
  const { data: period } = await db.from("payroll_periods").select("*").eq("id", id).single();
  if (!period) return fail("Payroll period not found.");
  if (period.status === "reversed") return fail("Payroll is already reversed.");
  if (Number(period.paid_amount) > 0) {
    return fail("Payroll has payments recorded; those payments must be reversed through their payment vouchers first.");
  }
  const { data: updated, error: uError } = await db
    .from("payroll_periods")
    .update({ status: "reversed", reversal_reason: reason, balance_amount: 0 })
    .eq("id", id)
    .select()
    .single();
  if (uError) return fail(uError.message);
  await logAudit(db, {
    action: "reverse", entityType: "payroll_periods", entityId: id,
    before: { status: period.status }, after: { status: "reversed" },
    reason, userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data: updated };
}

// ---------------------------------------------------------------- reports & advances

export async function getPayrollRegister(input: {
  month: number;
  year: number;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireRead(db);
  if ("error" in gate) return fail(gate.error);
  const { data, error: qError } = await db.from("payroll_periods").select("*")
    .eq("month", input.month).eq("year", input.year)
    .neq("status", "reversed").order("employee_id", { ascending: true });
  if (qError) return fail(qError.message);
  const totals = (data ?? []).reduce((t, p) => ({
    gross: roundMoney(t.gross + (Number(p.gross_pay) || 0)),
    net: roundMoney(t.net + (Number(p.net_payable) || 0)),
    paid: roundMoney(t.paid + (Number(p.paid_amount) || 0)),
    balance: roundMoney(t.balance + (Number(p.balance_amount) || 0)),
  }), { gross: 0, net: 0, paid: 0, balance: 0 });
  return { success: true, data: { month: input.month, year: input.year, rows: data, totals } };
}

export async function getUnpaidSalaries(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireRead(db);
  if ("error" in gate) return fail(gate.error);
  const { data, error: qError } = await db.from("payroll_periods").select("*")
    .in("status", ["approved", "partially_paid"])
    .gt("balance_amount", 0)
    .order("year", { ascending: true }).order("month", { ascending: true });
  if (qError) return fail(qError.message);
  const totalUnpaid = (data ?? []).reduce((s, p) => roundMoney(s + (Number(p.balance_amount) || 0)), 0);
  return { success: true, data: { rows: data, totalUnpaid } };
}

export async function listPayrollPayments(payrollId: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireRead(db);
  if ("error" in gate) return fail(gate.error);
  const { data, error: qError } = await db.from("payroll_payments").select("*")
    .eq("payroll_id", payrollId).order("date", { ascending: true });
  if (qError) return fail(qError.message);
  return { success: true, data };
}

export async function recordAdvance(input: {
  employeeId: string;
  date?: string;
  amount: number;
  notes?: string;
}): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireWrite(db);
  if ("error" in gate) return fail(gate.error);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail("Advance amount must be > 0.");
  const { data, error: iError } = await db
    .from("employee_advances")
    .insert({
      employee_id: input.employeeId, date: input.date ?? new Date().toISOString().slice(0, 10),
      amount: roundMoney(amount), notes: input.notes ?? null, created_by: gate.actor.userId,
    })
    .select()
    .single();
  if (iError) return fail(iError.message);
  await logAudit(db, {
    action: "create", entityType: "employee_advances", entityId: data.id,
    after: { employee_id: input.employeeId, amount: roundMoney(amount) },
    userId: gate.actor.userId, userEmail: gate.actor.email,
  });
  return { success: true, data };
}

export async function listAdvances(employeeId?: string): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return fail(error);
  const gate = await requireRead(db);
  if ("error" in gate) return fail(gate.error);
  let q = db.from("employee_advances").select("*").order("date", { ascending: false });
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error: qError } = await q;
  if (qError) return fail(qError.message);
  return { success: true, data };
}
