"use client"

import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"

import * as React from "react"
import {
  Users2,
  Calendar,
  CheckCircle2,
  DollarSign,
  UserCheck,
} from "lucide-react"
import { markAttendance, correctAttendance, listAttendance, listPayroll, runPayroll, approvePayroll, payPayroll, getUnpaidSalaries, getAttendanceSummary, listAdvances, recordAdvance, adjustPayroll, reversePayroll, updatePayrollRules, getPayrollRegister, listPayrollPayments, getPayrollEstimate } from "@/app/actions/payroll"
import { listEmployees, createEmployee, updateEmployee, deactivateEmployee, reactivateEmployee } from "@/app/actions/masters"
import { listCashAccounts } from "@/app/actions/finance"
import { Employee, AttendanceStatus } from "@/lib/types/database"
import { formatCurrency } from "@/lib/utils"
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

export default function EmployeesPage() {
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
  const [tab, setTab] = React.useState<"directory" | "attendance" | "payroll" | "advances">("directory")
  // Directory (all staff, including inactive) — the attendance/payroll lists
  // above stay active-only, exactly as the old payroll page loaded them.
  const [allEmployees, setAllEmployees] = React.useState<any[]>([])
  const [dirCode, setDirCode] = React.useState("")
  const [dirName, setDirName] = React.useState("")
  const [dirDesignation, setDirDesignation] = React.useState("")
  const [dirPhone, setDirPhone] = React.useState("")
  const [dirPayType, setDirPayType] = React.useState("monthly")
  const [dirBaseRate, setDirBaseRate] = React.useState<number>(0)
  const [dirJoiningDate, setDirJoiningDate] = React.useState("")
  const [dirPayPref, setDirPayPref] = React.useState("")
  const [dirPending, setDirPending] = React.useState(false)
  const [editEmp, setEditEmp] = React.useState<any | null>(null)
  const [editEmpPending, setEditEmpPending] = React.useState(false)
  const [deactEmp, setDeactEmp] = React.useState<any | null>(null)
  const [deactEmpPending, setDeactEmpPending] = React.useState(false)
  const switchTab = (t: "directory" | "attendance" | "payroll" | "advances") => {
    setTab(t)
    try {
      const params = new URLSearchParams(window.location.search)
      params.set("tab", t)
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`)
    } catch { /* tab state still applies; only the shareable URL is skipped */ }
  }
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
  const [registerRows, setRegisterRows] = React.useState<any[]>([])
  const [registerTotals, setRegisterTotals] = React.useState<any | null>(null)
  const [estimate, setEstimate] = React.useState<any | null>(null)
  const [estimateError, setEstimateError] = React.useState("")
  const [payHistoryPeriodId, setPayHistoryPeriodId] = React.useState("")
  const [payHistoryRows, setPayHistoryRows] = React.useState<any[]>([])
  const [ledgerEmpId, setLedgerEmpId] = React.useState("")
  const [ledgerPayments, setLedgerPayments] = React.useState<Record<string, any[]>>({})
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
  const payTokenRef = React.useRef<string | null>(null)

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
      const [em, att, per, un, all, sum, adv, ca, attMonthPeriods, reg, est] = await Promise.all([
        listEmployees(), listAttendance({ from: attendanceDate, to: attendanceDate }),
        listPayroll({ month: now.getMonth() + 1, year: now.getFullYear() }), getUnpaidSalaries(),
        listPayroll({}), getAttendanceSummary({ from: range.from, to: range.to }),
        listAdvances(), listCashAccounts(), listPayroll({ month: attMonth, year: attYear }),
        getPayrollRegister({ month: attMonth, year: attYear }), getPayrollEstimate({ month: attMonth, year: attYear }),
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
      const regData: any = reg.data ?? {}
      setRegisterRows(Array.isArray(regData.rows) ? regData.rows : [])
      setRegisterTotals(regData.totals ?? null)
      if (est.success) { setEstimate(est.data); setEstimateError("") }
      else { setEstimate(null); setEstimateError(est.error ?? "Payroll estimate unavailable.") }
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
  // Dashboard drill-down (?filter=unpaid) is read once on mount and then
  // applied to the finalized list below — not just shown as a banner.
  React.useEffect(() => {
    setDrillFilter(getUrlFilter())
    try {
      const params = new URLSearchParams(window.location.search)
      const t = params.get("tab")
      if (t === "directory" || t === "attendance" || t === "payroll" || t === "advances") setTab(t)
      else if (params.get("filter")) setTab("payroll")
    } catch { /* keep the default tab */ }
    listEmployees(true).then((res) => { if (res.success) setAllEmployees(Array.isArray(res.data) ? res.data : []) })
  }, [])
  React.useEffect(() => {
    if (!attendanceDate) return
    if (mountLoadedFor.current === attendanceDate) return
    mountLoadedFor.current = attendanceDate
    loadData()
  }, [loadData, attendanceDate])

  // Payment history for one selected period, and the employee ledger
  // (periods + payments per employee) — both loaded on demand.
  React.useEffect(() => {
    if (!payHistoryPeriodId) { setPayHistoryRows([]); return }
    listPayrollPayments(payHistoryPeriodId).then((res) => {
      if (res.success) setPayHistoryRows(Array.isArray(res.data) ? res.data : [])
      else setFormError(res.error ?? "Could not load payment history.")
    })
  }, [payHistoryPeriodId])
  const ledgerPeriods = React.useMemo(
    () => [...periods, ...unpaid, ...drafts].filter((p: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === p.id) === i && (!ledgerEmpId || p.employee_id === ledgerEmpId)),
    [periods, unpaid, drafts, ledgerEmpId],
  )
  React.useEffect(() => {
    if (!ledgerEmpId) return
    const missing = ledgerPeriods.filter((p: any) => !(p.id in ledgerPayments))
    if (missing.length === 0) return
    Promise.all(missing.map((p: any) => listPayrollPayments(p.id).then((res) => ({ id: p.id, rows: res.success && Array.isArray(res.data) ? res.data : [] }))))
      .then((results) => setLedgerPayments((prev) => ({ ...prev, ...Object.fromEntries(results.map((r) => [r.id, r.rows])) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerEmpId, ledgerPeriods.length])

  // Changed rows vs the saved roster: unchanged rows are never re-sent.
  const changedEmps = React.useMemo(() => employees.filter((emp) => {
    const orig = originalAtt[emp.id]
    const status = attendanceState[emp.id] || "present"
    const ot = overtimeState[emp.id] ?? 0
    if (!orig) return true
    return orig.status !== status || orig.overtime !== ot
  }), [employees, originalAtt, attendanceState, overtimeState])
  const needsCorrection = changedEmps.some((emp) => originalAtt[emp.id])

  const loadDirectory = React.useCallback(async () => {
    const res = await listEmployees(true)
    if (res.success) setAllEmployees(Array.isArray(res.data) ? res.data : [])
    else setFormError(res.error ?? "Could not load employees.")
  }, [])

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (dirPending || !dirCode.trim() || !dirName.trim() || !dirDesignation.trim()) {
      setFormError("Employee code, full name and designation are required.")
      return
    }
    if (dirBaseRate < 0) return setFormError("Base rate cannot be negative.")
    setDirPending(true)
    try {
      const res = await createEmployee({
        code: dirCode.trim(), full_name: dirName.trim(), designation: dirDesignation.trim(),
        phone: dirPhone.trim() || undefined, pay_type: dirPayType, base_rate: dirBaseRate,
        joining_date: dirJoiningDate || undefined, payment_preference: dirPayPref || undefined,
      })
      if (!res.success) { setFormError(res.error ?? "Could not create employee."); return }
      setFormNotice(`Employee "${dirName.trim()}" created.`)
      setDirCode(""); setDirName(""); setDirDesignation(""); setDirPhone("")
      setDirPayType("monthly"); setDirBaseRate(0); setDirJoiningDate(""); setDirPayPref("")
      await loadDirectory()
      await loadData()
    } finally { setDirPending(false) }
  }

  const handleSaveDirEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editEmp || editEmpPending) return
    if (!editEmp.full_name.trim() || !editEmp.designation.trim()) return setFormError("Employee name and designation are required.")
    if (Number(editEmp.base_rate || 0) < 0) return setFormError("Base rate cannot be negative.")
    setEditEmpPending(true)
    try {
      const res = await updateEmployee(editEmp.id, {
        full_name: editEmp.full_name.trim(), designation: editEmp.designation.trim(),
        phone: editEmp.phone?.trim() || undefined, pay_type: editEmp.pay_type,
        base_rate: Number(editEmp.base_rate || 0),
        joining_date: editEmp.joining_date || undefined,
        payment_preference: editEmp.payment_preference || null,
      })
      if (!res.success) { setFormError(res.error ?? "Could not update employee."); return }
      setFormNotice(`"${editEmp.full_name.trim()}" updated.`)
      setEditEmp(null)
      await loadDirectory()
      await loadData()
    } finally { setEditEmpPending(false) }
  }

  const handleDeactivateDir = async () => {
    if (!deactEmp || deactEmpPending) return
    setDeactEmpPending(true)
    try {
      const res = await deactivateEmployee(deactEmp.id)
      if (!res.success) { setFormError(res.error ?? "Could not deactivate employee."); return }
      setFormNotice(`"${deactEmp.full_name}" deactivated — never deleted; history is kept.`)
      setDeactEmp(null)
      await loadDirectory()
      await loadData()
    } finally { setDeactEmpPending(false) }
  }

  const handleReactivateDir = async (emp: any) => {
    const res = await reactivateEmployee(emp.id)
    if (!res.success) { setFormError(res.error ?? "Could not reactivate employee."); return }
    setFormNotice(`"${emp.full_name}" is active again.`)
    await loadDirectory()
    await loadData()
  }

  const handleSaveAttendance = () => {
    if (!attendanceDate) return setFormError("Pick the attendance date first.")
    if (attendanceDate > new Date().toISOString().slice(0, 10)) return setFormError("Attendance cannot be marked for a future date. Pick today or an earlier date.")
    if (employees.length === 0) return setFormError("No employees exist yet. Add staff in Directory before marking attendance.")
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
        clientToken: submissionToken(payTokenRef, "payrollpay"),
      })
      if (!res.success) { setFormError(res.error ?? "Could not pay payroll."); return }
      setFormNotice(`Payroll payment of ${formatCurrency(payAmount)} recorded from ${acct?.name ?? "the selected account"}.`)
      resetSubmissionToken(payTokenRef)
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

  // Estimate comes from the server action, which applies the CONFIGURED
  // payroll rules (half-day factor, leave/holiday paid, monthly mode,
  // overtime rate). No factor is hard-coded on this page any more.
  const estimateRows: any[] = Array.isArray(estimate?.rows) ? estimate.rows : []
  const estimateTotals = estimate?.totals ?? { base: 0, overtime: 0, advances: 0, net: 0 }
  const estimateRules = estimate?.rules
  const visibleFinalized = React.useMemo(() => {
    const merged = [...periods, ...unpaid.filter((u) => !periods.some((p) => p.id === u.id))]
    return drillFilter === "unpaid" ? merged.filter((p: any) => Number(p.balance_amount || 0) > 0) : merged
  }, [periods, unpaid, drillFilter])

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
            Employees
          </h1>
        </div>
        {tab === "attendance" && (<button
          type="button"
          onClick={handleSaveAttendance}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
          <span>{isPending ? "Saving…" : "Save Attendance"}</span>
        </button>)}
      </div>

      <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-muted border border-border w-fit">
        {(["directory", "attendance", "payroll", "advances"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-bold capitalize cursor-pointer transition-colors ${tab === t ? "bg-emerald-600 text-white shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Directory */}
      {tab === "directory" && (<div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Add an employee</h2>
        <p className="text-xs text-muted-foreground mb-4">Staff created here appear in attendance and payroll. Deactivation is reversible — records are never deleted.</p>
        <form onSubmit={handleCreateEmployee} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs mb-6">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="dir-code">Code *</label><input id="dir-code" value={dirCode} onChange={(e) => setDirCode(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="dir-name">Full name *</label><input id="dir-name" value={dirName} onChange={(e) => setDirName(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="dir-designation">Designation *</label><input id="dir-designation" value={dirDesignation} onChange={(e) => setDirDesignation(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="dir-phone">Phone</label><input id="dir-phone" value={dirPhone} onChange={(e) => setDirPhone(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="dir-pay-type">Wage category</label><select id="dir-pay-type" value={dirPayType} onChange={(e) => setDirPayType(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="monthly">Monthly Salary</option><option value="daily">Daily Wage</option><option value="piece_rate">Piece Rate</option></select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="dir-base-rate">Base rate</label><input id="dir-base-rate" type="number" min="0" value={dirBaseRate} onChange={(e) => setDirBaseRate(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="dir-joining-date">Joining date</label><input id="dir-joining-date" type="date" value={dirJoiningDate} onChange={(e) => setDirJoiningDate(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="dir-pay-pref">Payment preference</label><select id="dir-pay-pref" value={dirPayPref} onChange={(e) => setDirPayPref(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Not recorded</option><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="cheque">Cheque</option></select></div>
          <div className="sm:col-span-4 flex justify-end"><button type="submit" disabled={dirPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{dirPending ? "Creating…" : "Add employee"}</button></div>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Code</th>
                <th className="pb-3 font-bold">Staff Name</th>
                <th className="pb-3 font-bold">Designation</th>
                <th className="pb-3 font-bold">Wage Category</th>
                <th className="pb-3 font-bold text-right">Base Rate</th>
                <th className="pb-3 font-bold">Phone</th>
                <th className="pb-3 font-bold">Payment</th>
                <th className="pb-3 font-bold text-center">Status</th>
                <th className="pb-3 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allEmployees.length === 0 && (
                <tr><td colSpan={9} className="py-4"><EmptyState title="No employees yet" hint="Add the first staff member with the form above." /></td></tr>
              )}
              {allEmployees.map((emp: any) => (
                <tr key={emp.id} className="hover:bg-muted transition-colors">
                  <td className="py-3 font-mono font-bold text-muted-foreground">{emp.code}</td>
                  <td className="py-3 font-bold text-foreground">{emp.full_name}</td>
                  <td className="py-3 text-muted-foreground">{emp.designation}</td>
                  <td className="py-3 text-muted-foreground capitalize">{emp.pay_type === "monthly" ? "Monthly Salary" : emp.pay_type === "piece_rate" ? "Piece Rate" : "Daily Wage"}</td>
                  <td className="py-3 text-right font-mono font-bold text-foreground">{formatCurrency(emp.base_rate)} {emp.pay_type === "daily" ? "/ day" : emp.pay_type === "piece_rate" ? "/ piece" : "/ mo"}</td>
                  <td className="py-3 text-muted-foreground">{emp.phone || "—"}</td>
                  <td className="py-3 text-muted-foreground">{emp.payment_preference || "—"}</td>
                  <td className="py-3 text-center">{emp.is_active === false ? "Inactive" : "Active"}</td>
                  <td className="py-3 text-center">
                    <button type="button" onClick={() => setEditEmp({ ...emp })} className="px-2 py-0.5 rounded-md hover:bg-muted font-semibold cursor-pointer">Edit</button>
                    {emp.is_active !== false ? (<button type="button" onClick={() => setDeactEmp(emp)} className="ml-1 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 font-semibold cursor-pointer">Deactivate</button>) : (<button type="button" onClick={() => handleReactivateDir(emp)} className="ml-1 px-2 py-0.5 rounded-md hover:bg-muted font-semibold cursor-pointer">Reactivate</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>)}
      {editEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Edit {editEmp.full_name}</h3>
              <button type="button" onClick={() => setEditEmp(null)} className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={handleSaveDirEdit} className="space-y-4 text-xs">
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-emp-name">Full name *</label><input id="edit-emp-name" value={editEmp.full_name} onChange={(e) => setEditEmp({ ...editEmp, full_name: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-emp-designation">Designation *</label><input id="edit-emp-designation" value={editEmp.designation} onChange={(e) => setEditEmp({ ...editEmp, designation: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-emp-phone">Phone</label><input id="edit-emp-phone" value={editEmp.phone || ""} onChange={(e) => setEditEmp({ ...editEmp, phone: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-emp-pay-type">Wage category</label><select id="edit-emp-pay-type" value={editEmp.pay_type} onChange={(e) => setEditEmp({ ...editEmp, pay_type: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="monthly">Monthly Salary</option><option value="daily">Daily Wage</option><option value="piece_rate">Piece Rate</option></select></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-emp-base-rate">Base rate</label><input id="edit-emp-base-rate" type="number" min="0" value={Number(editEmp.base_rate || 0)} onChange={(e) => setEditEmp({ ...editEmp, base_rate: Number(e.target.value) || 0 })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-emp-joining">Joining date</label><input id="edit-emp-joining" type="date" value={editEmp.joining_date?.slice(0, 10) || ""} onChange={(e) => setEditEmp({ ...editEmp, joining_date: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-emp-pay-pref">Payment preference</label><select id="edit-emp-pay-pref" value={editEmp.payment_preference || ""} onChange={(e) => setEditEmp({ ...editEmp, payment_preference: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Not recorded</option><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="cheque">Cheque</option></select></div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditEmp(null)} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Cancel</button>
                <button type="submit" disabled={editEmpPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60">{editEmpPending ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deactEmp !== null}
        title={`Deactivate "${deactEmp?.full_name ?? ""}"?`}
        description="This never deletes the record: it becomes inactive, stays in history, and is hidden from new vouchers."
        confirmLabel="Deactivate"
        destructive
        pending={deactEmpPending}
        onConfirm={handleDeactivateDir}
        onCancel={() => setDeactEmp(null)}
      />

      {/* Daily Attendance Grid */}
      {tab === "attendance" && (<div className="expensive-card p-5">
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
            <label className="block font-medium text-foreground mb-1" htmlFor="correction-reason">Correction reason * (required — changing already-saved marks)</label>
            <input id="correction-reason"
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
                    <EmptyState title="No employees yet" hint="Add staff in Directory, then mark attendance here." />
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
      </div>)}

      {/* Payroll Estimate from recorded attendance — server-computed with configured rules */}
      {tab === "payroll" && (<div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            Payroll Estimate
          </h2>
          <span className="text-xs text-muted-foreground font-mono">From recorded attendance, {attendanceDate ? `${attendanceDate.slice(0, 7)}` : ""}</span>
        </div>
        {estimateError && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{estimateError} The estimate is not shown rather than computed from guessed rules.</p>}
        {estimateRules && <p className="text-[11px] text-muted-foreground mb-3">Configured rules applied: half-day factor {estimateRules.halfDayFactor}, leave {estimateRules.leavePaid ? "paid" : "unpaid"}, holiday {estimateRules.holidayPaid ? "paid" : "unpaid"}, monthly mode {estimateRules.monthlyMode}, overtime rate {estimateRules.overtimeRatePerHour ?? "not set"}.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Employee</th>
                <th className="pb-3 font-bold text-right">Present / Half / Leave / Absent / Holiday</th>
                <th className="pb-3 font-bold text-right">Overtime hrs</th>
                <th className="pb-3 font-bold text-right">Eligible Days</th>
                <th className="pb-3 font-bold text-right">Base Earned</th>
                <th className="pb-3 font-bold text-right">Overtime Pay</th>
                <th className="pb-3 font-bold text-right">Open Advances</th>
                <th className="pb-3 font-bold text-right">Estimated Net</th>
                <th className="pb-3 font-bold text-center">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {estimateRows.map((r: any) => (
                <tr key={r.employeeId} className="hover:bg-muted transition-colors">
                  <td className="py-3 font-bold text-foreground font-sans">{r.employeeName}</td>
                  <td className="py-3 text-right">{r.present || 0} / {r.half_day || 0} / {r.leave || 0} / {r.absent || 0} / {r.holiday || 0}</td>
                  <td className="py-3 text-right">{r.overtime_hours || 0}</td>
                  <td className="py-3 text-right">{r.payableDays} days</td>
                  <td className="py-3 text-right font-bold text-foreground">{formatCurrency(r.basePay)}</td>
                  <td className="py-3 text-right">{formatCurrency(r.overtimePay)}</td>
                  <td className="py-3 text-right text-destructive">-{formatCurrency(r.openAdvances)}</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">{formatCurrency(r.estimatedNet)}</td>
                  <td className="py-3 text-center">
                    <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase font-sans">Estimate</span>
                    {r.pieceFallback && <div className="text-[10px] text-amber-600 font-sans mt-0.5">pieces not counted — days fallback</div>}
                  </td>
                </tr>
              ))}
              {estimateRows.length > 0 && (
                <tr className="border-t-2 border-border font-bold">
                  <td className="py-3 font-sans" colSpan={4}>Estimate totals</td>
                  <td className="py-3 text-right">{formatCurrency(estimateTotals.base)}</td>
                  <td className="py-3 text-right">{formatCurrency(estimateTotals.overtime)}</td>
                  <td className="py-3 text-right text-destructive">-{formatCurrency(estimateTotals.advances)}</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">{formatCurrency(estimateTotals.net)}</td>
                  <td className="py-3" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Estimate from recorded attendance for this month under the configured payroll rules, with overtime at the configured rate and open advances recovered in full. A real run recovers only the amount requested, capped by the balance. This is a projection, not a pay run.
        </p>
      </div>)}

      {/* Payroll register (spec §13.3): month totals + every period row */}
      {tab === "payroll" && (<div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Payroll Register — {attendanceDate ? attendanceDate.slice(0, 7) : ""}</h2>
        <p className="text-xs text-muted-foreground mb-4">Every non-reversed period for the month. Totals: gross {formatCurrency(Number(registerTotals?.gross || 0))} · net {formatCurrency(Number(registerTotals?.net || 0))} · paid {formatCurrency(Number(registerTotals?.paid || 0))} · balance {formatCurrency(Number(registerTotals?.balance || 0))}.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Net payable</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2 text-center">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {registerRows.length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground">No payroll periods for this month yet.</td></tr>}
            {registerRows.map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employees.find((e) => e.id === p.employee_id)?.full_name ?? p.employee_id}</td><td className="py-2 text-right">{formatCurrency(Number(p.gross_pay || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(p.balance_amount || 0))}</td><td className="py-2 text-center">{p.status}</td></tr>))}
            {registerRows.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2">Totals</td><td className="py-2 text-right">{formatCurrency(Number(registerTotals?.gross || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(registerTotals?.net || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(registerTotals?.paid || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(registerTotals?.balance || 0))}</td><td /></tr>)}
          </tbody></table></div>
      </div>)}

      {/* Payment history + employee ledger */}
      {tab === "payroll" && (<div className="expensive-card p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="text-xs">
          <h2 className="text-sm font-bold text-foreground mb-1">Payment History</h2>
          <p className="text-muted-foreground mb-3">Pick a period to see every payment recorded against it.</p>
          <select value={payHistoryPeriodId} onChange={(e) => setPayHistoryPeriodId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground mb-3"><option value="">Select period</option>{[...periods, ...unpaid, ...drafts].filter((p: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === p.id) === i).map((p: any) => (<option key={p.id} value={p.id}>{employees.find((e) => e.id === p.employee_id)?.full_name ?? "Not set"} — {p.month}/{p.year} ({p.status})</option>))}</select>
          {payHistoryPeriodId && payHistoryRows.length === 0 && <p className="text-muted-foreground">No payments recorded for this period yet.</p>}
          {payHistoryRows.length > 0 && (<table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Date</th><th className="pb-2 text-right">Amount</th><th className="pb-2">Method</th><th className="pb-2">Reference</th></tr></thead><tbody className="divide-y divide-border">{payHistoryRows.map((r: any) => (<tr key={r.id}><td className="py-2">{r.date?.slice(0, 10)}</td><td className="py-2 text-right">{formatCurrency(Number(r.amount || 0))}</td><td className="py-2">{r.payment_method ?? r.account ?? "—"}</td><td className="py-2 font-mono">{r.reference_no ?? "—"}</td></tr>))}</tbody></table>)}
        </div>
        <div className="text-xs">
          <h2 className="text-sm font-bold text-foreground mb-1">Employee Ledger</h2>
          <p className="text-muted-foreground mb-3">All periods for one employee, each with its payments.</p>
          <select value={ledgerEmpId} onChange={(e) => setLedgerEmpId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground mb-3"><option value="">Select employee</option>{employees.map((e) => (<option key={e.id} value={e.id}>{e.full_name}</option>))}</select>
          {ledgerEmpId && ledgerPeriods.length === 0 && <p className="text-muted-foreground">No payroll periods for this employee yet.</p>}
          {ledgerPeriods.map((p: any) => (
            <div key={p.id} className="border border-border rounded-lg p-3 mb-2">
              <div className="flex justify-between font-semibold"><span>{p.month}/{p.year} ({p.status})</span><span>Net {formatCurrency(Number(p.net_payable || 0))} · Paid {formatCurrency(Number(p.paid_amount || 0))} · Balance {formatCurrency(Number(p.balance_amount || 0))}</span></div>
              {(ledgerPayments[p.id] ?? []).length > 0 ? (
                <ul className="mt-2 space-y-1 text-muted-foreground">{(ledgerPayments[p.id] ?? []).map((r: any) => (<li key={r.id}>{r.date?.slice(0, 10)} — {formatCurrency(Number(r.amount || 0))} via {r.payment_method ?? r.account ?? "—"}{r.reference_no ? ` (${r.reference_no})` : ""}</li>))}</ul>
              ) : (<p className="text-muted-foreground mt-1">No payments yet.</p>)}
            </div>
          ))}
        </div>
      </div>)}

      {/* Drafts: all months */}
      {tab === "payroll" && (<div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Payroll Drafts (all months)</h2>
        <p className="text-xs text-muted-foreground mb-4">Drafts from every month, not just the current one. Approve a draft here, then pay it from the finalized list.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Period</th><th className="pb-2 text-right">Net payable</th><th className="pb-2 text-center">Action</th></tr></thead>
          <tbody className="divide-y divide-border">
            {drafts.length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground">No drafts — run a payroll below to create one.</td></tr>}
            {drafts.map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employees.find((e) => e.id === p.employee_id)?.full_name ?? "Not set"}</td><td className="py-2">{p.month}/{p.year}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-center"><button type="button" onClick={() => handleApprove(p.id)} className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Approve</button></td></tr>))}
          </tbody></table></div>
      </div>)}

      {/* Run payroll */}
      {tab === "payroll" && (<div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Finalized Payroll</h2>
        <p className="text-xs text-muted-foreground mb-4">Only approved or partially-paid periods with a balance appear here. Total unpaid: {formatCurrency(unpaidTotal)}.{drillFilter === "unpaid" ? " Dashboard drill-down applied: only periods with a balance are shown — clear the filter banner above to see all." : ""}</p>
        <form onSubmit={handleRunPayroll} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs mb-4">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="employee-2">Employee *</label><select id="employee-2" value={runEmployeeId} onChange={(e) => setRunEmployeeId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select employee</option>{employees.map((e) => (<option key={e.id} value={e.id}>{e.full_name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="month">Month</label><input id="month" type="number" value={runMonth} onChange={(e) => setRunMonth(Number(e.target.value))} min="1" max="12" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="year">Year</label><input id="year" type="number" value={runYear} onChange={(e) => setRunYear(Number(e.target.value))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="bonus">Bonus</label><input id="bonus" type="number" min="0" value={runBonus} onChange={(e) => setRunBonus(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="deductions">Deductions</label><input id="deductions" type="number" min="0" value={runDeductions} onChange={(e) => setRunDeductions(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="previous-balance-signed-carry-in">Previous balance (signed carry-in)</label><input id="previous-balance-signed-carry-in" type="number" value={runPrevBalance} onChange={(e) => setRunPrevBalance(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="pieces-piece-rate-only-blank-fallback">Pieces (piece-rate only; blank = fallback)</label><input id="pieces-piece-rate-only-blank-fallback" type="number" min="0" value={runPieces} onChange={(e) => setRunPieces(e.target.value)} placeholder="Leave blank if not piece-rate" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="overtime-rate-hour-blank-configured-rate">Overtime rate / hour (blank = configured rate)</label><input id="overtime-rate-hour-blank-configured-rate" type="number" min="0" value={runOtRate} onChange={(e) => setRunOtRate(e.target.value)} placeholder="Leave blank to use configured rate" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="advance-recovery-requested">Advance recovery requested</label><input id="advance-recovery-requested" type="number" min="0" value={runAdvRecovery} onChange={(e) => setRunAdvRecovery(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div className="sm:col-span-2"><label className="block font-medium text-foreground mb-1" htmlFor="notes-2">Notes</label><input id="notes-2" value={runNotes} onChange={(e) => setRunNotes(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="flex items-end"><button type="submit" disabled={runPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{runPending ? "Running…" : "Run payroll (draft)"}</button></div>
        </form>
        {runWarnings.length > 0 && (
          <AlertBanner tone="warning" message={`Run warnings: ${runWarnings.join(" ")}`} />
        )}
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Period</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Net payable</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {visibleFinalized.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No payroll periods yet — run the first draft above.</td></tr>}
            {visibleFinalized.map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employees.find((e) => e.id === p.employee_id)?.full_name ?? "Not set"}</td><td className="py-2">{p.month}/{p.year}</td><td className="py-2 text-right">{formatCurrency(Number(p.gross_pay || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(p.balance_amount || 0))}</td><td className="py-2 text-center">{p.status}{p.status === "draft" && (<button type="button" onClick={() => handleApprove(p.id)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Approve</button>)}{(p.status === "approved" || p.status === "partially_paid") && Number(p.balance_amount || 0) > 0 && (<button type="button" onClick={() => openPay(p)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Pay</button>)}</td></tr>))}
          </tbody></table></div>
      </div>)}

      {/* Adjust / reverse */}
      {tab === "payroll" && (<div className="expensive-card p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleAdjust} className="space-y-3 text-xs">
          <h2 className="text-sm font-bold text-foreground">Adjust an approved payroll</h2>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="period-approved-partially-paid">Period (approved / partially paid)</label><select id="period-approved-partially-paid" value={adjPeriodId} onChange={(e) => setAdjPeriodId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select period</option>{[...periods, ...unpaid, ...drafts].filter((p: any) => ["approved", "partially_paid"].includes(p.status)).map((p: any) => (<option key={p.id} value={p.id}>{employees.find((e) => e.id === p.employee_id)?.full_name ?? "Not set"} — {p.month}/{p.year} ({p.status})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="change-in-net-payable-can-be-negative">Change in net payable (can be negative)</label><input id="change-in-net-payable-can-be-negative" type="number" value={adjDelta} onChange={(e) => setAdjDelta(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="reason-3">Reason *</label><input id="reason-3" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">Adjust payroll</button>
        </form>
        <div className="space-y-3 text-xs">
          <h2 className="text-sm font-bold text-foreground">Reverse a payroll</h2>
          <p className="text-muted-foreground">Reversal is blocked by the server once any payment exists on the period.</p>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="period">Period</label><select id="period" value={revPeriodId} onChange={(e) => setRevPeriodId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select period</option>{[...periods, ...unpaid, ...drafts].map((p: any) => (<option key={p.id} value={p.id}>{employees.find((e) => e.id === p.employee_id)?.full_name ?? "Not set"} — {p.month}/{p.year} ({p.status})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="reason-2">Reason *</label><input id="reason-2" value={revReason} onChange={(e) => setRevReason(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <button type="button" onClick={() => { if (!revPeriodId) return setFormError("Select a period to reverse."); if (!revReason.trim()) return setFormError("A reason is mandatory to reverse payroll."); setShowRevConfirm(true) }} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold cursor-pointer">Reverse payroll</button>
        </div>
      </div>)}

      {/* Advances */}
      {tab === "advances" && (<div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Advances</h2>
        <form onSubmit={handleAdvance} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs mb-4">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="employee">Employee *</label><select id="employee" value={advEmpId} onChange={(e) => setAdvEmpId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select employee</option>{employees.map((e) => (<option key={e.id} value={e.id}>{e.full_name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="amount">Amount</label><input id="amount" type="number" min="0" value={advAmount} onChange={(e) => setAdvAmount(Math.max(0, Number(e.target.value) || 0))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="date">Date</label><input id="date" type="date" value={advDate} onChange={(e) => setAdvDate(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="notes">Notes</label><input id="notes" value={advNotes} onChange={(e) => setAdvNotes(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="sm:col-span-4 flex justify-end"><button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">Record advance</button></div>
        </form>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Date</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">Recovered</th><th className="pb-2 text-center">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {advances.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">No advances recorded yet.</td></tr>}
            {advances.map((a: any) => (<tr key={a.id}><td className="py-2 font-semibold">{employees.find((e) => e.id === a.employee_id)?.full_name ?? a.employee_id}</td><td className="py-2">{a.date?.slice(0, 10)}</td><td className="py-2 text-right">{formatCurrency(Number(a.amount || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(a.recovered_amount || 0))}</td><td className="py-2 text-center">{a.status}</td></tr>))}
          </tbody></table></div>
      </div>)}

      {/* Payroll rules (owner only, enforced server-side) */}
      {tab === "payroll" && (<div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Payroll rules</h2>
        <p className="text-xs text-muted-foreground mb-4">Owner only — the server rejects changes from any other role. Changes affect future runs only.</p>
        <form onSubmit={handleRules} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="half-day-factor-0-1">Half-day factor (0–1)</label><input id="half-day-factor-0-1" type="number" min="0" max="1" step="0.1" value={ruleHalfFactor} onChange={(e) => setRuleHalfFactor(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="leave-paid">Leave paid?</label><select id="leave-paid" value={ruleLeavePaid ? "yes" : "no"} onChange={(e) => setRuleLeavePaid(e.target.value === "yes")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="no">No</option><option value="yes">Yes</option></select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="holiday-paid">Holiday paid?</label><select id="holiday-paid" value={ruleHolidayPaid ? "yes" : "no"} onChange={(e) => setRuleHolidayPaid(e.target.value === "yes")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="no">No</option><option value="yes">Yes</option></select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="monthly-mode">Monthly mode</label><select id="monthly-mode" value={ruleMonthlyMode} onChange={(e) => setRuleMonthlyMode(e.target.value as "fixed" | "prorated")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="fixed">Fixed</option><option value="prorated">Prorated</option></select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="overtime-rate-hour-blank-none">Overtime rate / hour (blank = none)</label><input id="overtime-rate-hour-blank-none" type="number" min="0" value={ruleOtRate} onChange={(e) => setRuleOtRate(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="reason">Reason *</label><input id="reason" value={ruleReason} onChange={(e) => setRuleReason(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="sm:col-span-3 flex justify-end"><button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">Update rules</button></div>
        </form>
      </div>)}

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
        description={payTarget ? `Pay ${formatCurrency(payAmount)} for ${employees.find((e) => e.id === payTarget.employee_id)?.full_name ?? "Not set"} (${payTarget.month}/${payTarget.year}) from ${cashAccounts.find((a: any) => a.id === payAccountId)?.name ?? "the selected cash account"} by ${payMethod}${payRef.trim() ? `, reference ${payRef.trim()}` : ""}. Balance after: ${formatCurrency(Math.max(0, Number(payTarget.balance_amount || 0) - payAmount))}.` : ""}
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
