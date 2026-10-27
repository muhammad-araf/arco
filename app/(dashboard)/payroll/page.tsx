"use client"

import * as React from "react"
import {
  Users2,
  Calendar,
  CheckCircle2,
  DollarSign,
  UserCheck,
} from "lucide-react"
import { markAttendance, correctAttendance, listAttendance, listPayroll, runPayroll, approvePayroll, payPayroll, getUnpaidSalaries, getAttendanceSummary, listAdvances, recordAdvance, adjustPayroll, reversePayroll, updatePayrollRules } from "@/app/actions/payroll"
import { listEmployees } from "@/app/actions/masters"
import { listCashAccounts } from "@/app/actions/finance"
import { Employee, AttendanceStatus } from "@/lib/types/database"
import { formatCurrency } from "@/lib/utils"
import { dailyPay, eligibleDays } from "@/lib/calc/payroll"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  SubmitSpinner,
  getUrlFilter,
} from "@/components/erp-ui"
import { PayrollSkeleton } from "@/components/route-skeletons"

const ALL_STATUSES: AttendanceStatus[] = ["present", "half_day", "leave", "absent", "holiday"]
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present", half_day: "Half-Day", leave: "Leave", absent: "Absent", holiday: "Holiday",
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`
  const last = new Date(year, month, 0).getDate()
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` }
}

export default function PayrollPage() {
  const [employees, setEmployees] = React.useState<Employee[]>([])
  const [attendanceDate, setAttendanceDate] = React.useState("")
  const [attendanceState, setAttendanceState] = React.useState<{ [empId: string]: AttendanceStatus }>({})
  const [overtimeState, setOvertimeState] = React.useState<{ [empId: string]: number }>({})
  const [originalAtt, setOriginalAtt] = React.useState<{ [empId: string]: { status: AttendanceStatus; overtime: number } }>({})
  const [correctionReason, setCorrectionReason] = React.useState("")
  const [lockedNames, setLockedNames] = React.useState<string[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const [periods, setPeriods] = React.useState<any[]>([])
  const [drafts, setDrafts] = React.useState<any[]>([])
  const [unpaid, setUnpaid] = React.useState<any[]>([])
  const [unpaidTotal, setUnpaidTotal] = React.useState(0)
  const [runEmployeeId, setRunEmployeeId] = React.useState("")
  const [runMonth, setRunMonth] = React.useState(0)
  const [runYear, setRunYear] = React.useState(0)
  const [runBonus, setRunBonus] = React.useState<number>(0)
  const [runDeductions, setRunDeductions] = React.useState<number>(0)
  const [runPrevBalance, setRunPrevBalance] = React.useState<number>(0)
  const [runPieces, setRunPieces] = React.useState<string>("")
  const [runOtRate, setRunOtRate] = React.useState<string>("")
  const [runAdvRecovery, setRunAdvRecovery] = React.useState<number>(0)
  const [runNotes, setRunNotes] = React.useState("")
  const [runWarnings, setRunWarnings] = React.useState<string[]>([])
  const [runPending, setRunPending] = React.useState(false)
  const [summary, setSummary] = React.useState<any[]>([])
  const [advances, setAdvances] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  // Pay dialog
  const [payTarget, setPayTarget] = React.useState<any | null>(null)
  const [payAmount, setPayAmount] = React.useState<number>(0)
  const [payAccountId, setPayAccountId] = React.useState("")
  const [payMethod, setPayMethod] = React.useState("cash")
  const [payDate, setPayDate] = React.useState("")
  const [payRef, setPayRef] = React.useState("")
  const [payPending, setPayPending] = React.useState(false)
  // Adjust / reverse / advance / rules
  const [adjPeriodId, setAdjPeriodId] = React.useState("")
  const [adjDelta, setAdjDelta] = React.useState<number>(0)
  const [adjReason, setAdjReason] = React.useState("")
  const [revPeriodId, setRevPeriodId] = React.useState("")
  const [revReason, setRevReason] = React.useState("")
  const [showRevConfirm, setShowRevConfirm] = React.useState(false)
  const [advEmpId, setAdvEmpId] = React.useState("")
  const [advAmount, setAdvAmount] = React.useState<number>(0)
  const [advDate, setAdvDate] = React.useState("")
  const [advNotes, setAdvNotes] = React.useState("")
  const [ruleHalfFactor, setRuleHalfFactor] = React.useState<number>(0.5)
  const [ruleLeavePaid, setRuleLeavePaid] = React.useState(false)
  const [ruleHolidayPaid, setRuleHolidayPaid] = React.useState(true)
  const [ruleMonthlyMode, setRuleMonthlyMode] = React.useState<"fixed" | "prorated">("fixed")
  const [ruleOtRate, setRuleOtRate] = React.useState<string>("")
  const [ruleReason, setRuleReason] = React.useState("")
  const saveGuard = React.useRef(false)

  React.useEffect(() => {
    const now = new Date()
    setAttendanceDate(now.toISOString().slice(0, 10))
    setRunMonth(now.getMonth() + 1)
    setRunYear(now.getFullYear())
    setPayDate(now.toISOString().slice(0, 10))
    setAdvDate(now.toISOString().slice(0, 10))
  }, [])

  const loadData = React.useCallback(async () => {
    if (!attendanceDate) return
    setIsLoading(true)
    try {
      const now = new Date()
      const attYear = Number(attendanceDate.slice(0, 4))
      const attMonth = Number(attendanceDate.slice(5, 7))
      const range = monthRange(attYear, attMonth)
      const [em, att, per, un, all, sum, adv, ca, attMonthPeriods] = await Promise.all([
        listEmployees(), listAttendance({ from: attendanceDate, to: attendanceDate }),
        listPayroll({ month: now.getMonth() + 1, year: now.getFullYear() }), getUnpaidSalaries(),
        listPayroll({}), getAttendanceSummary({ from: range.from, to: range.to }),
        listAdvances(), listCashAccounts(), listPayroll({ month: attMonth, year: attYear }),
      ])
      const failed = [em, att, per, un, all, sum, adv, ca, attMonthPeriods].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load payroll data.")
      const emps = (Array.isArray(em.data) ? em.data : []) as Employee[]
      setEmployees(emps)
      const initialAtt: { [empId: string]: AttendanceStatus } = {}
      const initialOt: { [empId: string]: number } = {}
      const orig: { [empId: string]: { status: AttendanceStatus; overtime: number } } = {}
      emps.forEach((emp) => { initialAtt[emp.id] = "present"; initialOt[emp.id] = 0 })
      for (const row of (Array.isArray(att.data) ? att.data : []) as any[]) {
        if (row.employee_id && row.status) {
          initialAtt[row.employee_id] = row.status
          initialOt[row.employee_id] = Number(row.overtime_hours || 0)
          orig[row.employee_id] = { status: row.status, overtime: Number(row.overtime_hours || 0) }
        }
      }
      setAttendanceState(initialAtt)
      setOvertimeState(initialOt)
      setOriginalAtt(orig)
      setPeriods(Array.isArray(per.data) ? per.data : [])
      setDrafts((Array.isArray(all.data) ? all.data : []).filter((p: any) => p.status === "draft"))
      const unData: any = un.data ?? {}
      setUnpaid(Array.isArray(unData.rows) ? unData.rows : [])
      setUnpaidTotal(Number(unData.totalUnpaid || 0))
      const sumData: any = sum.data ?? {}
      setSummary(Array.isArray(sumData.employees) ? sumData.employees : [])
      setAdvances(Array.isArray(adv.data) ? adv.data : [])
      setCashAccounts(Array.isArray(ca.data) ? ca.data : [])
      const locked = new Set<string>()
      for (const p of (Array.isArray(attMonthPeriods.data) ? attMonthPeriods.data : []) as any[]) {
        if (["approved", "partially_paid", "paid"].includes(p.status)) locked.add(p.employee_id)
      }
      setLockedNames(emps.filter((e) => locked.has(e.id)).map((e) => e.full_name))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load payroll data.")
    } finally {
      setIsLoading(false)
    }
  }, [attendanceDate])

  const mountLoadedFor = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!attendanceDate) return
    if (mountLoadedFor.current === attendanceDate) return
    mountLoadedFor.current = attendanceDate
    loadData()
    setDrillFilter(getUrlFilter())
  }, [loadData, attendanceDate])

  // Changed rows vs the saved roster: unchanged rows are never re-sent.
  const changedEmps = React.useMemo(() => employees.filter((emp) => {
    const orig = originalAtt[emp.id]
    const status = attendanceState[emp.id] || "present"
    const ot = overtimeState[emp.id] ?? 0
    if (!orig) return true
    return orig.status !== status || orig.overtime !== ot
  }), [employees, originalAtt, attendanceState, overtimeState])
  const needsCorrection = changedEmps.some((emp) => originalAtt[emp.id])

  const handleSaveAttendance = () => {
    if (!attendanceDate) return setFormError("Pick the attendance date first.")
    if (attendanceDate > new Date().toISOString().slice(0, 10)) return setFormError("Attendance cannot be marked for a future date. Pick today or an earlier date.")
    if (employees.length === 0) return setFormError("No employees exist yet. Add staff in Masters before marking attendance.")
    if (changedEmps.length === 0) {
      setFormNotice(`No changes for ${attendanceDate} — the roster already matches what is saved, so nothing was re-sent.`)
      return
    }
    if (lockedNames.length > 0 && changedEmps.some((e) => lockedNames.includes(e.full_name))) {
      return setFormError("Payroll for this month is approved or paid for some staff, so their attendance is locked. Change it through a payroll adjustment or reversal instead — the server blocks corrections in a locked period.")
    }
    if (needsCorrection && !correctionReason.trim()) {
      return setFormError("You are changing marks that are already saved. Type a correction reason below first — corrections require a real reason.")
    }
    setFormError("")
    setShowConfirm(true)
  }

  const handleConfirmSave = async () => {
    if (saveGuard.current) return
    saveGuard.current = true
    setIsPending(true)
    try {
      let saved = 0
      const errors: string[] = []
      for (const emp of changedEmps) {
        const status = attendanceState[emp.id] || "present"
        const ot = overtimeState[emp.id] ?? 0
        if (!originalAtt[emp.id]) {
          const marked = await markAttendance({ employeeId: emp.id, date: attendanceDate, status, overtimeHours: ot })
          if (marked.success) saved++
          else errors.push(`${emp.full_name}: ${marked.error ?? "failed"}`)
        } else {
          const corrected = await correctAttendance({ employeeId: emp.id, date: attendanceDate, status, overtimeHours: ot, reason: correctionReason.trim() })
          if (corrected.success) saved++
          else errors.push(`${emp.full_name}: ${corrected.error ?? "failed"}`)
        }
      }
      if (errors.length) setFormError(errors.join(" | "))
      else setFormNotice(`Attendance saved for ${attendanceDate}: ${saved} changed record(s). Unchanged rows were left alone.`)
      setShowConfirm(false)
      setCorrectionReason("")
      await loadData()
    } finally {
      setIsPending(false)
      saveGuard.current = false
    }
  }

  const handleRunPayroll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (runPending || !runEmployeeId) return
    if (runBonus < 0 || runDeductions < 0 || runAdvRecovery < 0) return setFormError("Bonus, deductions and advance recovery cannot be negative.")
    const pieces = runPieces.trim() === "" ? undefined : Number(runPieces)
    if (pieces !== undefined && (!Number.isFinite(pieces) || pieces < 0)) return setFormError("Pieces must be >= 0, or left blank.")
    const otRate = runOtRate.trim() === "" ? undefined : Number(runOtRate)
    if (otRate !== undefined && (!Number.isFinite(otRate) || otRate < 0)) return setFormError("Overtime rate must be >= 0, or left blank to use the configured rate.")
    setRunPending(true)
    try {
      const res = await runPayroll({
        employeeId: runEmployeeId, month: runMonth, year: runYear,
        bonus: runBonus, deductions: runDeductions, previousBalance: runPrevBalance,
        pieces, overtimeRatePerHour: otRate, advanceRecoveryRequested: runAdvRecovery,
        notes: runNotes.trim() || undefined,
      })
      if (!res.success) { setFormError(res.error ?? "Could not run payroll."); return }
      const warnings = (res.data as any)?.warnings as string[] | undefined
      setRunWarnings(Array.isArray(warnings) ? warnings : [])
      setFormNotice("Payroll period created as a draft. Approve it, then pay it.")
      await loadData()
    } finally { setRunPending(false) }
  }

  const handleApprove = async (id: string) => {
    const res = await approvePayroll(id)
    if (!res.success) { setFormError(res.error ?? "Could not approve payroll."); return }
    setFormNotice("Payroll period approved.")
    await loadData()
  }

  const openPay = (period: any) => {
    setPayTarget(period)
    setPayAmount(Number(period.balance_amount || 0))
    setPayAccountId(cashAccounts.length > 0 ? cashAccounts[0].id : "")
    setPayMethod("cash")
    setPayRef("")
  }

  const handleConfirmPay = async () => {
    if (!payTarget || payPending) return
    if (!(payAmount > 0)) return setFormError("Payment amount must be greater than zero.")
    if (payAmount > Number(payTarget.balance_amount || 0)) return setFormError("Payment exceeds the unpaid balance — partial payments must be within the balance.")
    if (!payAccountId) return setFormError("Select the cash account this payment comes from.")
    const acct = cashAccounts.find((a: any) => a.id === payAccountId)
    setPayPending(true)
    try {
      const res = await payPayroll({
        payrollId: payTarget.id, amount: payAmount, date: payDate || undefined,
        paymentMethod: payMethod, cashAccountId: payAccountId,
        account: (acct?.account_kind ?? "cash") as "cash" | "bank" | "online",
        referenceNo: payRef.trim() || undefined,
      })
      if (!res.success) { setFormError(res.error ?? "Could not pay payroll."); return }
      setFormNotice(`Payroll payment of ${formatCurrency(payAmount)} recorded from ${acct?.name ?? "the selected account"}.`)
      setPayTarget(null)
      await loadData()
    } finally { setPayPending(false) }
  }

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adjPeriodId) return setFormError("Select an approved period to adjust.")
    if (!adjReason.trim()) return setFormError("A reason is mandatory for payroll adjustments.")
    const res = await adjustPayroll(adjPeriodId, adjDelta, adjReason.trim())
    if (!res.success) { setFormError(res.error ?? "Could not adjust payroll."); return }
    setFormNotice("Payroll adjusted.")
    setAdjReason("")
    await loadData()
  }

  const handleReverse = async () => {
    if (!revPeriodId) return setFormError("Select a period to reverse.")
    if (!revReason.trim()) return setFormError("A reason is mandatory to reverse payroll.")
    const res = await reversePayroll(revPeriodId, revReason.trim())
    if (!res.success) { setFormError(res.error ?? "Could not reverse payroll."); return }
    setFormNotice("Payroll reversed.")
    setShowRevConfirm(false)
    setRevReason("")
    await loadData()
  }

  const handleAdvance = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!advEmpId) return setFormError("Select an employee for the advance.")
    if (!(advAmount > 0)) return setFormError("Advance amount must be greater than zero.")
    const res = await recordAdvance({ employeeId: advEmpId, date: advDate || undefined, amount: advAmount, notes: advNotes.trim() || undefined })
    if (!res.success) { setFormError(res.error ?? "Could not record advance."); return }
    setFormNotice("Advance recorded.")
    await loadData()
  }

  const handleRules = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ruleReason.trim()) return setFormError("A reason is mandatory to change payroll rules.")
    const otRate = ruleOtRate.trim() === "" ? null : Number(ruleOtRate)
    if (otRate !== null && (!Number.isFinite(otRate) || otRate < 0)) return setFormError("Overtime rate must be >= 0, or left blank.")
    const res = await updatePayrollRules({
      halfDayFactor: ruleHalfFactor, leavePaid: ruleLeavePaid, holidayPaid: ruleHolidayPaid,
      monthlyMode: ruleMonthlyMode, overtimeRatePerHour: otRate,
    }, ruleReason.trim())
    if (!res.success) { setFormError(res.error ?? "Could not update payroll rules."); return }
    setFormNotice("Payroll rules updated (owner only). Future runs use the new rules.")
    setRuleReason("")
  }

  const openAdvanceByEmp = (empId: string) => advances
    .filter((a: any) => a.employee_id === empId && a.status === "open")
    .reduce((s: number, a: any) => s + (Number(a.amount) || 0) - (Number(a.recovered_amount) || 0), 0)

  const estimateRows = employees.map((emp) => {
    const s: any = summary.find((x: any) => x.employeeId === emp.id) ?? { present: 0, half_day: 0, leave: 0, absent: 0, holiday: 0, overtime_hours: 0 }
    const days = eligibleDays(
      { present: s.present || 0, half_day: s.half_day || 0, leave: s.leave || 0, absent: s.absent || 0, holiday: s.holiday || 0 },
      { halfDayFactor: 0.5, leavePaid: false, holidayPaid: true },
    )
    const base = emp.pay_type === "monthly" ? emp.base_rate : dailyPay(s.present || 0, s.half_day || 0, emp.base_rate, 0.5)
    const openAdv = openAdvanceByEmp(emp.id)
    return { emp, s, days, base, openAdv, net: Math.max(0, base - openAdv) }
  })
  const estimateTotals = estimateRows.reduce((a, r) => ({ base: a.base + r.base, adv: a.adv + r.openAdv, net: a.net + r.net }), { base: 0, adv: 0, net: 0 })

  if (isLoading) return <PayrollSkeleton />

  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      {lockedNames.length > 0 && (
        <AlertBanner tone="warning" message={`Payroll for this month is approved or paid for: ${lockedNames.join(", ")}. Their attendance is locked — use a payroll adjustment or reversal instead of re-marking.`} />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Users2 className="h-6 w-6 text-emerald-500" />
            Payroll
          </h1>
        </div>
        <button
          type="button"
          onClick={handleSaveAttendance}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
          <span>{isPending ? "Saving…" : "Save Attendance"}</span>
        </button>
      </div>

      {/* Daily Attendance Grid */}
      <div className="expensive-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-emerald-500" />
              Attendance
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={attendanceDate}
              onChange={(e) => setAttendanceDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground font-mono"
            />
          </div>
        </div>
        {needsCorrection && (
          <div className="mb-3 text-xs">
            <label className="block font-medium text-foreground mb-1">Correction reason * (required — changing already-saved marks)</label>
            <input
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              placeholder="Why are these marks changing? Type a real reason."
              className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
            />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Code</th>
                <th className="pb-3 font-bold">Staff Name</th>
                <th className="pb-3 font-bold">Designation</th>
                <th className="pb-3 font-bold">Wage Category</th>
                <th className="pb-3 font-bold text-right">Base Rate</th>
                <th className="pb-3 font-bold text-center">Mark Status</th>
                <th className="pb-3 font-bold text-center">Overtime hrs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4">
                    <EmptyState title="No employees yet" hint="Add staff in Masters, then mark attendance here." />
                  </td>
                </tr>
              )}
              {employees.map((emp) => {
                const currentStatus = attendanceState[emp.id] || "present"
                return (
                  <tr key={emp.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{emp.code}</td>
                    <td className="py-3 font-bold text-foreground">{emp.full_name}</td>
                    <td className="py-3 text-muted-foreground">{emp.designation}</td>
                    <td className="py-3 text-muted-foreground capitalize">
                      {emp.pay_type === "monthly" ? "Monthly Salary" : emp.pay_type === "piece_rate" ? "Piece Rate" : "Daily Wage"}
                    </td>
                    <td className="py-3 text-right font-mono font-bold text-foreground">
                      {formatCurrency(emp.base_rate)} {emp.pay_type === "daily" ? "/ day" : emp.pay_type === "piece_rate" ? "/ piece" : "/ mo"}
                    </td>
                    <td className="py-3 text-center">
                      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-muted border border-border">
                        {ALL_STATUSES.map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setAttendanceState((prev) => ({ ...prev, [emp.id]: st }))}
                            className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                              currentStatus === st ? "bg-emerald-600 text-white shadow-xs" : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {STATUS_LABEL[st]}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 text-center">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={overtimeState[emp.id] ?? 0}
                        onChange={(e) => setOvertimeState((prev) => ({ ...prev, [emp.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        className="w-20 px-2 py-1.5 rounded-lg bg-background border border-border text-foreground font-mono text-center"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">Saving again only sends rows you changed. Changing a saved mark needs a typed reason above, and marks in an approved or paid month are locked.</p>
      </div>

      {/* Payroll Estimate from recorded attendance */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            Payroll Estimate
          </h2>
          <span className="text-xs text-muted-foreground font-mono">From recorded attendance, {attendanceDate ? `${attendanceDate.slice(0, 7)}` : ""}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Employee</th>
                <th className="pb-3 font-bold text-right">Present / Half / Leave / Absent / Holiday</th>
                <th className="pb-3 font-bold text-right">Overtime hrs</th>
                <th className="pb-3 font-bold text-right">Eligible Days</th>
                <th className="pb-3 font-bold text-right">Base Earned</th>
                <th className="pb-3 font-bold text-right">Open Advances</th>
                <th className="pb-3 font-bold text-right">Estimated Net</th>
                <th className="pb-3 font-bold text-center">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {estimateRows.map(({ emp, s, days, base, openAdv, net }) => (
                <tr key={emp.id} className="hover:bg-muted transition-colors">
                  <td className="py-3 font-bold text-foreground font-sans">{emp.full_name}</td>
                  <td className="py-3 text-right">{s.present || 0} / {s.half_day || 0} / {s.leave || 0} / {s.absent || 0} / {s.holiday || 0}</td>
                  <td className="py-3 text-right">{s.overtime_hours || 0}</td>
                  <td className="py-3 text-right">{days} days</td>
                  <td className="py-3 text-right font-bold text-foreground">{formatCurrency(base)}</td>
                  <td className="py-3 text-right text-destructive">-{formatCurrency(openAdv)}</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">{formatCurrency(net)}</td>
                  <td className="py-3 text-center">
                    <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase font-sans">Estimate</span>
                    {emp.pay_type === "piece_rate" && <div className="text-[10px] text-amber-600 font-sans mt-0.5">pieces not counted — days fallback</div>}
                  </td>
                </tr>
              ))}
              {employees.length > 0 && (
                <tr className="border-t-2 border-border font-bold">
                  <td className="py-3 font-sans" colSpan={4}>Estimate totals</td>
                  <td className="py-3 text-right">{formatCurrency(estimateTotals.base)}</td>
                  <td className="py-3 text-right text-destructive">-{formatCurrency(estimateTotals.adv)}</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">{formatCurrency(estimateTotals.net)}</td>
                  <td className="py-3" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Estimate from recorded attendance for this month (holidays paid, leave unpaid, half day at half rate) and open advances. Estimated net assumes open advances are recovered in full; a real run recovers only the amount requested, capped by the balance. Monthly staff are shown at their full base rate; overtime pay is not included because no overtime rate is applied here. This is a projection, not a pay run.
        </p>
      </div>

      {/* Drafts: all months */}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Payroll Drafts (all months)</h2>
        <p className="text-xs text-muted-foreground mb-4">Drafts from every month, not just the current one. Approve a draft here, then pay it from the finalized list.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Period</th><th className="pb-2 text-right">Net payable</th><th className="pb-2 text-center">Action</th></tr></thead>
          <tbody className="divide-y divide-border">
            {drafts.length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground">No drafts — run a payroll below to create one.</td></tr>}
            {drafts.map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employees.find((e) => e.id === p.employee_id)?.full_name ?? p.employee_id}</td><td className="py-2">{p.month}/{p.year}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-center"><button type="button" onClick={() => handleApprove(p.id)} className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Approve</button></td></tr>))}
          </tbody></table></div>
      </div>

      {/* Run payroll */}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Finalized Payroll</h2>
        <p className="text-xs text-muted-foreground mb-4">Only approved or partially-paid periods with a balance appear here. Total unpaid: {formatCurrency(unpaidTotal)}.</p>
        <form onSubmit={handleRunPayroll} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs mb-4">
          <div><label className="block font-medium text-foreground mb-1">Employee *</label><select value={runEmployeeId} onChange={(e) => setRunEmployeeId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select employee</option>{employees.map((e) => (<option key={e.id} value={e.id}>{e.full_name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Month</label><input type="number" value={runMonth} onChange={(e) => setRunMonth(Number(e.target.value))} min="1" max="12" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Year</label><input type="number" value={runYear} onChange={(e) => setRunYear(Number(e.target.value))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Bonus</label><input type="number" min="0" value={runBonus} onChange={(e) => setRunBonus(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Deductions</label><input type="number" min="0" value={runDeductions} onChange={(e) => setRunDeductions(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Previous balance (signed carry-in)</label><input type="number" value={runPrevBalance} onChange={(e) => setRunPrevBalance(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Pieces (piece-rate only; blank = fallback)</label><input type="number" min="0" value={runPieces} onChange={(e) => setRunPieces(e.target.value)} placeholder="Leave blank if not piece-rate" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Overtime rate / hour (blank = configured rate)</label><input type="number" min="0" value={runOtRate} onChange={(e) => setRunOtRate(e.target.value)} placeholder="Leave blank to use configured rate" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Advance recovery requested</label><input type="number" min="0" value={runAdvRecovery} onChange={(e) => setRunAdvRecovery(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div className="sm:col-span-2"><label className="block font-medium text-foreground mb-1">Notes</label><input value={runNotes} onChange={(e) => setRunNotes(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="flex items-end"><button type="submit" disabled={runPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{runPending ? "Running…" : "Run payroll (draft)"}</button></div>
        </form>
        {runWarnings.length > 0 && (
          <AlertBanner tone="warning" message={`Run warnings: ${runWarnings.join(" ")}`} />
        )}
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Period</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Net payable</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {periods.length === 0 && unpaid.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No payroll periods yet — run the first draft above.</td></tr>}
            {[...periods, ...unpaid.filter((u) => !periods.some((p) => p.id === u.id))].map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employees.find((e) => e.id === p.employee_id)?.full_name ?? p.employee_id}</td><td className="py-2">{p.month}/{p.year}</td><td className="py-2 text-right">{formatCurrency(Number(p.gross_pay || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(p.balance_amount || 0))}</td><td className="py-2 text-center">{p.status}{p.status === "draft" && (<button type="button" onClick={() => handleApprove(p.id)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Approve</button>)}{(p.status === "approved" || p.status === "partially_paid") && Number(p.balance_amount || 0) > 0 && (<button type="button" onClick={() => openPay(p)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Pay</button>)}</td></tr>))}
          </tbody></table></div>
      </div>

      {/* Adjust / reverse */}
      <div className="expensive-card p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleAdjust} className="space-y-3 text-xs">
          <h2 className="text-sm font-bold text-foreground">Adjust an approved payroll</h2>
          <div><label className="block font-medium text-foreground mb-1">Period (approved / partially paid)</label><select value={adjPeriodId} onChange={(e) => setAdjPeriodId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select period</option>{[...periods, ...unpaid, ...drafts].filter((p: any) => ["approved", "partially_paid"].includes(p.status)).map((p: any) => (<option key={p.id} value={p.id}>{employees.find((e) => e.id === p.employee_id)?.full_name ?? p.employee_id} — {p.month}/{p.year} ({p.status})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Change in net payable (can be negative)</label><input type="number" value={adjDelta} onChange={(e) => setAdjDelta(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Reason *</label><input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">Adjust payroll</button>
        </form>
        <div className="space-y-3 text-xs">
          <h2 className="text-sm font-bold text-foreground">Reverse a payroll</h2>
          <p className="text-muted-foreground">Reversal is blocked by the server once any payment exists on the period.</p>
          <div><label className="block font-medium text-foreground mb-1">Period</label><select value={revPeriodId} onChange={(e) => setRevPeriodId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select period</option>{[...periods, ...unpaid, ...drafts].map((p: any) => (<option key={p.id} value={p.id}>{employees.find((e) => e.id === p.employee_id)?.full_name ?? p.employee_id} — {p.month}/{p.year} ({p.status})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Reason *</label><input value={revReason} onChange={(e) => setRevReason(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <button type="button" onClick={() => { if (!revPeriodId) return setFormError("Select a period to reverse."); if (!revReason.trim()) return setFormError("A reason is mandatory to reverse payroll."); setShowRevConfirm(true) }} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold cursor-pointer">Reverse payroll</button>
        </div>
      </div>

      {/* Advances */}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Advances</h2>
        <form onSubmit={handleAdvance} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs mb-4">
          <div><label className="block font-medium text-foreground mb-1">Employee *</label><select value={advEmpId} onChange={(e) => setAdvEmpId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select employee</option>{employees.map((e) => (<option key={e.id} value={e.id}>{e.full_name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Amount</label><input type="number" min="0" value={advAmount} onChange={(e) => setAdvAmount(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Date</label><input type="date" value={advDate} onChange={(e) => setAdvDate(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Notes</label><input value={advNotes} onChange={(e) => setAdvNotes(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="sm:col-span-4 flex justify-end"><button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">Record advance</button></div>
        </form>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Date</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">Recovered</th><th className="pb-2 text-center">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {advances.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">No advances recorded yet.</td></tr>}
            {advances.map((a: any) => (<tr key={a.id}><td className="py-2 font-semibold">{employees.find((e) => e.id === a.employee_id)?.full_name ?? a.employee_id}</td><td className="py-2">{a.date?.slice(0, 10)}</td><td className="py-2 text-right">{formatCurrency(Number(a.amount || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(a.recovered_amount || 0))}</td><td className="py-2 text-center">{a.status}</td></tr>))}
          </tbody></table></div>
      </div>

      {/* Payroll rules (owner only, enforced server-side) */}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Payroll rules</h2>
        <p className="text-xs text-muted-foreground mb-4">Owner only — the server rejects changes from any other role. Changes affect future runs only.</p>
        <form onSubmit={handleRules} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1">Half-day factor (0–1)</label><input type="number" min="0" max="1" step="0.1" value={ruleHalfFactor} onChange={(e) => setRuleHalfFactor(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Leave paid?</label><select value={ruleLeavePaid ? "yes" : "no"} onChange={(e) => setRuleLeavePaid(e.target.value === "yes")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="no">No</option><option value="yes">Yes</option></select></div>
          <div><label className="block font-medium text-foreground mb-1">Holiday paid?</label><select value={ruleHolidayPaid ? "yes" : "no"} onChange={(e) => setRuleHolidayPaid(e.target.value === "yes")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="no">No</option><option value="yes">Yes</option></select></div>
          <div><label className="block font-medium text-foreground mb-1">Monthly mode</label><select value={ruleMonthlyMode} onChange={(e) => setRuleMonthlyMode(e.target.value as "fixed" | "prorated")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="fixed">Fixed</option><option value="prorated">Prorated</option></select></div>
          <div><label className="block font-medium text-foreground mb-1">Overtime rate / hour (blank = none)</label><input type="number" min="0" value={ruleOtRate} onChange={(e) => setRuleOtRate(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Reason *</label><input value={ruleReason} onChange={(e) => setRuleReason(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="sm:col-span-3 flex justify-end"><button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">Update rules</button></div>
        </form>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="Save attendance?"
        description={`Save ${changedEmps.length} changed mark(s) for ${attendanceDate}${needsCorrection ? ` with correction reason: "${correctionReason.trim()}"` : ""}. Unchanged rows are not re-sent.`}
        confirmLabel="Save Attendance"
        pending={isPending}
        onConfirm={handleConfirmSave}
        onCancel={() => setShowConfirm(false)}
      />
      <ConfirmDialog
        open={payTarget !== null}
        title="Confirm payroll payment?"
        description={payTarget ? `Pay ${formatCurrency(payAmount)} for ${employees.find((e) => e.id === payTarget.employee_id)?.full_name ?? payTarget.employee_id} (${payTarget.month}/${payTarget.year}) from ${cashAccounts.find((a: any) => a.id === payAccountId)?.name ?? "the selected cash account"} by ${payMethod}${payRef.trim() ? `, reference ${payRef.trim()}` : ""}. Balance after: ${formatCurrency(Math.max(0, Number(payTarget.balance_amount || 0) - payAmount))}.` : ""}
        confirmLabel="Confirm Payment"
        pending={payPending}
        onConfirm={handleConfirmPay}
        onCancel={() => setPayTarget(null)}
      />
      <ConfirmDialog
        open={showRevConfirm}
        title="Reverse this payroll?"
        description={`Reverse the selected period with reason: "${revReason.trim()}". This is blocked if any payment exists on the period.`}
        confirmLabel="Reverse Payroll"
        destructive
        onConfirm={handleReverse}
        onCancel={() => setShowRevConfirm(false)}
      />
    </div>
  )
}
