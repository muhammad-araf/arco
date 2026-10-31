"use client"

import * as React from "react"
import {
  Users2,
  Calendar,
  CheckCircle2,
  DollarSign,
  UserCheck,
} from "lucide-react"
import { markAttendance, correctAttendance, listAttendance, listPayroll, approvePayroll, getUnpaidSalaries, getAttendanceSummary, listAdvances, getPayrollRegister, listPayrollPayments, getPayrollEstimate, getEmployeesInitData } from "@/app/actions/payroll"
import { listEmployees, deactivateEmployee, reactivateEmployee } from "@/app/actions/masters"
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
import { EmployeesSkeleton } from "@/components/route-skeletons"
import { PayrollPrint } from "@/components/print/payroll-print"
import dynamic from "next/dynamic"

// Dialogs are code-split: each returns null while closed (verified in
// its component), so splitting its chunk out of the page bundle changes
// nothing on screen — the same props, the same dialog when opened.
// They stay mounted with the same props as before; only the import
// mechanism changes, so open/close and form state are untouched.
const EmployeeFormDialog = dynamic(() => import("@/components/employee-form-dialog").then((m) => m.EmployeeFormDialog))
const EmployeeViewDialog = dynamic(() => import("@/components/employee-view-dialog").then((m) => m.EmployeeViewDialog))
const PayrollRunDialog = dynamic(() => import("@/components/payroll-run-dialog").then((m) => m.PayrollRunDialog))
const PayrollPayDialog = dynamic(() => import("@/components/payroll-pay-dialog").then((m) => m.PayrollPayDialog))
const PayrollAdjustDialog = dynamic(() => import("@/components/payroll-adjust-dialog").then((m) => m.PayrollAdjustDialog))
const PayrollReverseDialog = dynamic(() => import("@/components/payroll-reverse-dialog").then((m) => m.PayrollReverseDialog))
const AdvanceDialog = dynamic(() => import("@/components/advance-dialog").then((m) => m.AdvanceDialog))
const PayrollRulesDialog = dynamic(() => import("@/components/payroll-rules-dialog").then((m) => m.PayrollRulesDialog))
import { PrintButton } from "@/components/print/print-button"

const ALL_STATUSES: AttendanceStatus[] = ["present", "half_day", "leave", "absent", "holiday"]
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present", half_day: "Half-Day", leave: "Leave", absent: "Absent", holiday: "Holiday",
}

/** Local YYYY-MM-DD (not UTC): toISOString() shows yesterday after 5am PKT. */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`
  const last = new Date(year, month, 0).getDate()
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` }
}

// One attendance-grid row, memoized on the employee object reference plus
// primitive status/overtime and stable callbacks. Every status click or
// overtime keystroke used to re-render the whole grid; unchanged rows
// now skip re-rendering. Cells copied verbatim from the old inline row,
// with the per-row setState closures replaced by the callbacks below.
const AttendanceRow = React.memo(function AttendanceRow(props: {
  emp: Employee
  currentStatus: AttendanceStatus
  overtime: number
  onStatus: (empId: string, status: AttendanceStatus) => void
  onOvertime: (empId: string, value: number) => void
}) {
  const { emp, currentStatus, overtime, onStatus, onOvertime } = props
  return (
    <tr className="hover:bg-muted transition-colors">
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
              onClick={() => onStatus(emp.id, st)}
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
          value={overtime}
          onChange={(e) => onOvertime(emp.id, Number(e.target.value))}
          className="w-20 px-2 py-1.5 rounded-lg bg-background border border-border text-foreground font-mono text-center"
        />
      </td>
    </tr>
  )
})

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
  // Directory dialogs: "new" = creating; a row = editing / viewing.
  const [empForm, setEmpForm] = React.useState<any | "new" | null>(null)
  const [viewEmp, setViewEmp] = React.useState<any | null>(null)
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
  const [runDialogOpen, setRunDialogOpen] = React.useState(false)
  const [runWarnings, setRunWarnings] = React.useState<string[]>([])
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
  // Pay dialog: one period at a time; the dialog owns amount/account/method.
  const [payPeriod, setPayPeriod] = React.useState<any | null>(null)
  const [printPayroll, setPrintPayroll] = React.useState<any | null>(null)
  const [adjDialogOpen, setAdjDialogOpen] = React.useState(false)
  const [revDialogOpen, setRevDialogOpen] = React.useState(false)
  const [advDialogOpen, setAdvDialogOpen] = React.useState(false)
  const [rulesDialogOpen, setRulesDialogOpen] = React.useState(false)
  const saveGuard = React.useRef(false)

  React.useEffect(() => {
    const now = new Date()
    setAttendanceDate(localToday())
  }, [])

  const loadData = React.useCallback(async () => {
    if (!attendanceDate) return
    setIsLoading(true)
    try {
      const attYear = Number(attendanceDate.slice(0, 4))
      const attMonth = Number(attendanceDate.slice(5, 7))
      const range = monthRange(attYear, attMonth)
      const initRes = await getEmployeesInitData({
        attendanceDate,
        attYear,
        attMonth,
        rangeFrom: range.from,
        rangeTo: range.to,
      })
      if (!initRes.success) {
        setFormError(initRes.error ?? "Could not load payroll data.")
        return
      }
      const data = initRes.data as any
      const emps = (Array.isArray(data.employees) ? data.employees : []) as Employee[]
      setEmployees(emps)
      const initialAtt: { [empId: string]: AttendanceStatus } = {}
      const initialOt: { [empId: string]: number } = {}
      const orig: { [empId: string]: { status: AttendanceStatus; overtime: number } } = {}
      emps.forEach((emp) => { initialAtt[emp.id] = "present"; initialOt[emp.id] = 0 })
      for (const row of (Array.isArray(data.attendance) ? data.attendance : []) as any[]) {
        if (row.employee_id && row.status) {
          initialAtt[row.employee_id] = row.status
          initialOt[row.employee_id] = Number(row.overtime_hours || 0)
          orig[row.employee_id] = { status: row.status, overtime: Number(row.overtime_hours || 0) }
        }
      }
      setAttendanceState(initialAtt)
      setOvertimeState(initialOt)
      setOriginalAtt(orig)
      setPeriods(Array.isArray(data.payrollCurrentMonth) ? data.payrollCurrentMonth : [])
      setDrafts((Array.isArray(data.allPayroll) ? data.allPayroll : []).filter((p: any) => p.status === "draft"))
      const unData: any = data.unpaid ?? {}
      setUnpaid(Array.isArray(unData.rows) ? unData.rows : (Array.isArray(data.unpaid) ? data.unpaid : []))
      setUnpaidTotal(Number(unData.totalUnpaid || 0))
      const sumData: any = data.attendanceSummary ?? {}
      setSummary(Array.isArray(sumData.employees) ? sumData.employees : (Array.isArray(data.attendanceSummary) ? data.attendanceSummary : []))
      setAdvances(Array.isArray(data.advances) ? data.advances : [])
      setCashAccounts(Array.isArray(data.cashAccounts) ? data.cashAccounts : [])
      const regData: any = data.register ?? {}
      setRegisterRows(Array.isArray(regData.rows) ? regData.rows : (Array.isArray(data.register) ? data.register : []))
      setRegisterTotals(regData.totals ?? null)
      if (data.estimate) { setEstimate(data.estimate); setEstimateError("") }
      else { setEstimate(null); setEstimateError("Payroll estimate unavailable.") }
      const locked = new Set<string>()
      for (const p of (Array.isArray(data.attMonthPeriods) ? data.attMonthPeriods : []) as any[]) {
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
  }, [ledgerEmpId, ledgerPeriods])

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
    if (attendanceDate > localToday()) return setFormError("Attendance cannot be marked for a future date. Pick today or an earlier date.")
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

  const handleApprove = async (id: string) => {
    const res = await approvePayroll(id)
    if (!res.success) { setFormError(res.error ?? "Could not approve payroll."); return }
    setFormNotice("Payroll period approved.")
    await loadData()
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
  const allPeriods = React.useMemo(
    () => [...periods, ...unpaid, ...drafts].filter((p: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === p.id) === i),
    [periods, unpaid, drafts],
  )
  // Employee-name map, rebuilt only when the employee list changes. The
  // old .find() ran once per row in the register, drafts, finalized and
  // advances tables (and per option in the payment-history select) on
  // every render. First entry wins, exactly as .find() did.
  const employeeNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const e of employees) if (!map.has(e.id)) map.set(e.id, e.full_name)
    return map
  }, [employees])
  const employeeName = (id: string) => employeeNameMap.get(id) ?? "Not set"
  // Stable attendance callbacks so AttendanceRow's memo is not defeated
  // by a new closure on every render; both use functional updates, so
  // they need no dependencies. The overtime clamp matches the old inline
  // handler (Number("") and NaN both become 0, then clamped at 0).
  const handleAttendanceStatus = React.useCallback((empId: string, st: AttendanceStatus) => {
    setAttendanceState((prev) => ({ ...prev, [empId]: st }))
  }, [])
  const handleAttendanceOvertime = React.useCallback((empId: string, value: number) => {
    setOvertimeState((prev) => ({ ...prev, [empId]: Math.max(0, value || 0) }))
  }, [])
  const visibleFinalized = React.useMemo(() => {
    const merged = [...periods, ...unpaid.filter((u) => !periods.some((p) => p.id === u.id))]
    return drillFilter === "unpaid" ? merged.filter((p: any) => Number(p.balance_amount || 0) > 0) : merged
  }, [periods, unpaid, drillFilter])

  if (isLoading) return <EmployeesSkeleton />

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
        {tab === "directory" && (<button
          type="button"
          onClick={() => setEmpForm("new")}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <span>Add employee</span>
        </button>)}
        {tab === "payroll" && (<span className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setRunDialogOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"><span>Run payroll</span></button>
          <button type="button" onClick={() => setAdjDialogOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-xs transition-colors cursor-pointer"><span>Adjust payroll</span></button>
          <button type="button" onClick={() => setRevDialogOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-xs transition-colors cursor-pointer"><span>Reverse payroll</span></button>
          <button type="button" onClick={() => setRulesDialogOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-xs transition-colors cursor-pointer"><span>Payroll rules</span></button>
        </span>)}
        {tab === "advances" && (<button
          type="button"
          onClick={() => setAdvDialogOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <span>Record advance</span>
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
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold text-foreground mb-1">Directory</h2>
            <p className="text-xs text-muted-foreground">Staff created here appear in attendance and payroll. Deactivation is reversible — records are never deleted.</p>
          </div>
          <button type="button" onClick={() => setEmpForm("new")} className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer">Add employee</button>
        </div>
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
                <tr><td colSpan={9} className="py-4"><EmptyState title="No employees yet" hint="Add the first staff member." actionLabel="Add employee" onAction={() => setEmpForm("new")} /></td></tr>
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
                    <button type="button" onClick={() => setViewEmp(emp)} className="px-2 py-0.5 rounded-md hover:bg-muted font-semibold cursor-pointer">View</button><button type="button" onClick={() => setEmpForm(emp)} className="ml-1 px-2 py-0.5 rounded-md hover:bg-muted font-semibold cursor-pointer">Edit</button>
                    {emp.is_active !== false ? (<button type="button" onClick={() => setDeactEmp(emp)} className="ml-1 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 font-semibold cursor-pointer">Deactivate</button>) : (<button type="button" onClick={() => handleReactivateDir(emp)} className="ml-1 px-2 py-0.5 rounded-md hover:bg-muted font-semibold cursor-pointer">Reactivate</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>)}
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
              {employees.map((emp) => (
                <AttendanceRow
                  key={emp.id}
                  emp={emp}
                  currentStatus={attendanceState[emp.id] || "present"}
                  overtime={overtimeState[emp.id] ?? 0}
                  onStatus={handleAttendanceStatus}
                  onOvertime={handleAttendanceOvertime}
                />
              ))}
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
                  <td className="py-3 text-right text-destructive">{r.openAdvances > 0 ? `-${formatCurrency(r.openAdvances)}` : formatCurrency(0)}</td>
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
                  <td className="py-3 text-right text-destructive">{estimateTotals.advances > 0 ? `-${formatCurrency(estimateTotals.advances)}` : formatCurrency(0)}</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">{formatCurrency(estimateTotals.net)}</td>
                  <td className="py-3" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Estimate from recorded attendance for this month under the configured payroll rules, with overtime at the configured rate and open advances recovered in full. A real run recovers only the amount requested, capped by the balance. This is a projection, not a pay run.{estimateRules?.monthlyMode === "fixed" ? " Monthly mode is Fixed: monthly staff are paid their full monthly rate even when no attendance is recorded for them, which is why base earned can be full while eligible days are 0." : ""}
        </p>
      </div>)}

      {/* Payroll register (spec §13.3): month totals + every period row */}
      {tab === "payroll" && (<div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Payroll Register — {attendanceDate ? attendanceDate.slice(0, 7) : ""}</h2>
        <p className="text-xs text-muted-foreground mb-4">Every non-reversed period for the month. Totals: gross {formatCurrency(Number(registerTotals?.gross || 0))} · net {formatCurrency(Number(registerTotals?.net || 0))} · paid {formatCurrency(Number(registerTotals?.paid || 0))} · balance {formatCurrency(Number(registerTotals?.balance || 0))}.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Net payable</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2 text-center">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {registerRows.length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground">No payroll periods for this month yet.</td></tr>}
            {registerRows.map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employeeNameMap.get(p.employee_id) ?? p.employee_id}</td><td className="py-2 text-right">{formatCurrency(Number(p.gross_pay || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(p.balance_amount || 0))}</td><td className="py-2 text-center">{p.status}</td></tr>))}
            {registerRows.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2">Totals</td><td className="py-2 text-right">{formatCurrency(Number(registerTotals?.gross || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(registerTotals?.net || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(registerTotals?.paid || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(registerTotals?.balance || 0))}</td><td /></tr>)}
          </tbody></table></div>
      </div>)}

      {/* Payment history + employee ledger */}
      {tab === "payroll" && (<div className="expensive-card p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="text-xs">
          <h2 className="text-sm font-bold text-foreground mb-1">Payment History</h2>
          <p className="text-muted-foreground mb-3">Pick a period to see every payment recorded against it.</p>
          <select value={payHistoryPeriodId} onChange={(e) => setPayHistoryPeriodId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground mb-3"><option value="">Select period</option>{allPeriods.map((p: any) => (<option key={p.id} value={p.id}>{employeeName(p.employee_id)} — {p.month}/{p.year} ({p.status})</option>))}</select>
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
            {drafts.length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground">No drafts — run a payroll from the Run payroll button above to create one.</td></tr>}
            {drafts.map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employeeName(p.employee_id)}</td><td className="py-2">{p.month}/{p.year}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-center"><button type="button" onClick={() => handleApprove(p.id)} className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Approve</button></td></tr>))}
          </tbody></table></div>
      </div>)}

      {/* Run payroll */}
      {tab === "payroll" && (<div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Finalized Payroll</h2>
        <p className="text-xs text-muted-foreground mb-4">Only approved or partially-paid periods with a balance appear here. Total unpaid: {formatCurrency(unpaidTotal)}.{drillFilter === "unpaid" ? " Dashboard drill-down applied: only periods with a balance are shown — clear the filter banner above to see all." : ""}</p>
        {runWarnings.length > 0 && (
          <AlertBanner tone="warning" message={`Run warnings: ${runWarnings.join(" ")}`} />
        )}
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Period</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Net payable</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {visibleFinalized.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No payroll periods yet — run the first draft from the Run payroll button above.</td></tr>}
            {visibleFinalized.map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employeeName(p.employee_id)}</td><td className="py-2">{p.month}/{p.year}</td><td className="py-2 text-right">{formatCurrency(Number(p.gross_pay || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(p.balance_amount || 0))}</td><td className="py-2 text-center">{p.status}<button type="button" onClick={() => setPrintPayroll(p)} className="ml-2 px-2 py-0.5 rounded-md bg-card hover:bg-muted border border-border text-[11px] font-semibold cursor-pointer">Print</button>{p.status === "draft" && (<button type="button" onClick={() => handleApprove(p.id)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Approve</button>)}{(p.status === "approved" || p.status === "partially_paid") && Number(p.balance_amount || 0) > 0 && (<button type="button" onClick={() => setPayPeriod(p)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Pay</button>)}</td></tr>))}
          </tbody></table></div>
      </div>)}

      {tab === "payroll" && printPayroll && (<div className="expensive-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Payroll print document for {employeeNameMap.get(printPayroll.employee_id) ?? "this employee"} — {printPayroll.month}/{printPayroll.year}.</p>
          <div className="flex gap-2">
            <PrintButton label="Print payroll" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
            <button type="button" onClick={() => setPrintPayroll(null)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-semibold cursor-pointer">Close</button>
          </div>
        </div>
        <div className="hidden print:block mt-2">
          <PayrollPrint
            periodLabel={`${printPayroll.month}/${printPayroll.year}`}
            employeeName={employeeNameMap.get(printPayroll.employee_id)}
            rows={[{ employee: employeeNameMap.get(printPayroll.employee_id), base: printPayroll.gross_pay, net: printPayroll.net_payable }]}
            totalNet={printPayroll.net_payable}
          />
        </div>
      </div>)}
      {/* Advances */}
      {tab === "advances" && (<div className="expensive-card p-5">
        <div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-sm font-bold text-foreground mb-1">Advances</h2><button type="button" onClick={() => setAdvDialogOpen(true)} className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer">Record advance</button></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Date</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">Recovered</th><th className="pb-2 text-center">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {advances.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">No advances recorded yet.</td></tr>}
            {advances.map((a: any) => (<tr key={a.id}><td className="py-2 font-semibold">{employeeNameMap.get(a.employee_id) ?? a.employee_id}</td><td className="py-2">{a.date?.slice(0, 10)}</td><td className="py-2 text-right">{formatCurrency(Number(a.amount || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(a.recovered_amount || 0))}</td><td className="py-2 text-center">{a.status}</td></tr>))}
          </tbody></table></div>
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
      <EmployeeFormDialog
        open={empForm !== null}
        employee={empForm === "new" ? null : empForm}
        employees={allEmployees}
        onClose={() => setEmpForm(null)}
        onSaved={(notice) => { setFormNotice(notice); void loadDirectory(); void loadData() }}
      />
      <EmployeeViewDialog
        open={viewEmp !== null}
        employee={viewEmp}
        openAdvances={viewEmp ? openAdvanceByEmp(viewEmp.id) : 0}
        onClose={() => setViewEmp(null)}
      />
      <PayrollRunDialog
        open={runDialogOpen}
        employees={employees}
        defaultMonth={new Date().getMonth() + 1}
        defaultYear={new Date().getFullYear()}
        onClose={() => setRunDialogOpen(false)}
        onSaved={(notice, warnings) => { setFormNotice(notice); setRunWarnings(warnings); void loadData() }}
      />
      <PayrollPayDialog
        open={payPeriod !== null}
        period={payPeriod}
        employeeName={payPeriod ? employeeName(payPeriod.employee_id) : ""}
        cashAccounts={cashAccounts}
        defaultDate={localToday()}
        onClose={() => setPayPeriod(null)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <PayrollAdjustDialog
        open={adjDialogOpen}
        periods={allPeriods}
        employeeName={employeeName}
        onClose={() => setAdjDialogOpen(false)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <PayrollReverseDialog
        open={revDialogOpen}
        periods={allPeriods}
        employeeName={employeeName}
        onClose={() => setRevDialogOpen(false)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <AdvanceDialog
        open={advDialogOpen}
        employees={employees}
        defaultDate={localToday()}
        onClose={() => setAdvDialogOpen(false)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <PayrollRulesDialog
        open={rulesDialogOpen}
        currentRules={estimateRules ?? null}
        onClose={() => setRulesDialogOpen(false)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
    </div>
  )
}
